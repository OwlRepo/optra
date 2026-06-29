import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users } from '@repo/db'
import { AppModule } from '../src/app.module'

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
    await pool.end()
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
})
