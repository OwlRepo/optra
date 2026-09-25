import { INestApplication, ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users } from '@repo/db'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap'

jest.setTimeout(30_000)

async function fireSequentially(
  app: INestApplication,
  count: number,
  build: (i: number) => request.Test,
): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < count; i++) {
    const res = await build(i)
    statuses.push(res.status)
  }
  return statuses
}

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterAll(async () => {
    const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, 'rate-limit-%'))
    for (const u of testUsers) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, u.id))
      await db.delete(otps).where(eq(otps.userId, u.id))
    }
    await db.delete(users).where(like(users.email, 'rate-limit-%'))
    await app.close()
  })

  it('throttles /auth/login with 429 after too many attempts from the same caller', async () => {
    const email = `rate-limit-login-${Date.now()}@example.com`
    const statuses = await fireSequentially(app, 11, () =>
      request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong-password' }),
    )

    expect(statuses).toContain(429)
  })

  it('throttles /auth/verify-otp with 429 after too many guesses', async () => {
    const email = `rate-limit-otp-${Date.now()}@example.com`
    const statuses = await fireSequentially(app, 6, () =>
      request(app.getHttpServer()).post('/auth/verify-otp').send({ email, code: '000000' }),
    )

    expect(statuses).toContain(429)
  })

  it('throttles /auth/register with 429 after too many attempts', async () => {
    const statuses = await fireSequentially(app, 6, (i) =>
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: `rate-limit-reg-${Date.now()}-${i}@example.com`, password: 'password123' }),
    )

    expect(statuses).toContain(429)
  })

  it('throttles /auth/refresh with 429 after too many attempts', async () => {
    const statuses = await fireSequentially(app, 21, () => request(app.getHttpServer()).post('/auth/refresh'))

    expect(statuses).toContain(429)
  })

  // TRUST_PROXY unset (this app): a client-sent X-Forwarded-For is ignored,
  // so rotating it cannot open a fresh bucket.
  it('error: without a trusted proxy a client cannot choose its own bucket', async () => {
    const email = `rate-limit-spoof-${Date.now()}@example.com`
    const statuses = await fireSequentially(app, 11, (i) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ email, password: 'wrong-password' }),
    )

    expect(statuses).toContain(429)
  })
})

// Production: the web app's BFF is the one trusted hop and forwards the
// visitor's address (apps/web/src/lib/http/client-ip.ts). Booted through
// configureApp, exactly as main.ts does, with its own throttler storage.
describe('Auth rate limiting behind one trusted proxy (e2e)', () => {
  let app: NestExpressApplication
  const originalTrustProxy = process.env.TRUST_PROXY

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1'
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app)
    await app.init()
  })

  afterAll(async () => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = originalTrustProxy
    await app.close()
  })

  it('error: the same visitor is still throttled after too many logins', async () => {
    const email = `rate-limit-visitor-a-${Date.now()}@example.com`
    const statuses = await fireSequentially(app, 11, () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email, password: 'wrong-password' }),
    )

    expect(statuses).toContain(429)
  })

  it("happy: a second visitor is not throttled by the first visitor's attempts", async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ email: `rate-limit-visitor-b-${Date.now()}@example.com`, password: 'wrong-password' })

    expect(res.status).toBe(401)
  })
})

// One pool for the whole file: each describe closes its own app; the pool
// ends only after both have run.
afterAll(async () => {
  await pool.end()
})
