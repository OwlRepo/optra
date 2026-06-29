import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users } from '@repo/db'
import { AppModule } from '../src/app.module'

describe('Auth flow (e2e)', () => {
  let app: INestApplication
  const email = `e2e-auth-${Date.now()}@example.com`
  const password = 'password123'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterAll(async () => {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (user) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
      await db.delete(otps).where(eq(otps.userId, user.id))
      await db.delete(users).where(eq(users.id, user.id))
    }
    await app.close()
    await pool.end()
  })

  it('registers, verifies via the real OTP, logs in, and rotates the refresh cookie on use', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    expect(registerRes.body.message).toMatch(/check your email/i)

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

    const verifyRes = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email, code: otp.code })
      .expect(201)

    expect(verifyRes.body.accessToken).toBeDefined()
    const verifyCookie = verifyRes.headers['set-cookie']?.[0]
    expect(verifyCookie).toMatch(/^mnemra_rt=/)
    expect(verifyCookie).toMatch(/HttpOnly/i)

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
    expect(loginRes.body.accessToken).toBeDefined()
    const loginCookie = loginRes.headers['set-cookie'][0].split(';')[0]

    // refresh rotates: new access token AND a brand-new cookie, different from the one sent in
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', loginCookie)
      .expect(200)
    expect(refreshRes.body.accessToken).toBeDefined()
    const rotatedCookie = refreshRes.headers['set-cookie']?.[0]?.split(';')[0]
    expect(rotatedCookie).toBeDefined()
    expect(rotatedCookie).not.toBe(loginCookie)

    // reusing the old (now-rotated-away) cookie is rejected
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', loginCookie).expect(401)

    // that reuse is treated as theft — even the newer, otherwise-valid rotated cookie is dead now too
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rotatedCookie).expect(401)
  })

  it('logout revokes the active session, and a subsequent refresh is then rejected', async () => {
    const logoutEmail = `e2e-auth-logout-${Date.now()}@example.com`
    try {
      await request(app.getHttpServer()).post('/auth/register').send({ email: logoutEmail, password }).expect(201)

      const [user] = await db.select().from(users).where(eq(users.email, logoutEmail)).limit(1)
      const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: logoutEmail, code: otp.code })
        .expect(201)
      const cookie = verifyRes.headers['set-cookie'][0].split(';')[0]

      await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(200)
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401)
    } finally {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, logoutEmail)).limit(1)
      if (user) {
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
        await db.delete(otps).where(eq(otps.userId, user.id))
        await db.delete(users).where(eq(users.id, user.id))
      }
    }
  })

  it('rejects a duplicate registration with 409', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(409)
  })

  it('rejects malformed registration input with 400 via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', password: '123' })
      .expect(400)
  })

  it('rejects login with the wrong password with 401', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong-pass' }).expect(401)
  })

  it('rejects refresh with no cookie at all with 401', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').expect(401)
  })
})
