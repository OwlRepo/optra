import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'

async function cleanupUserByEmail(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) return

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))

  await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
  await db.delete(otps).where(eq(otps.userId, user.id))
  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

  for (const membership of memberships) {
    await db.delete(workspaces).where(and(eq(workspaces.id, membership.workspaceId), eq(workspaces.ownerId, user.id)))
  }

  await db.delete(users).where(eq(users.id, user.id))
}

async function registerAndVerify(app: INestApplication, email: string, password: string) {
  await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201)

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

  const verifyRes = await request(app.getHttpServer())
    .post('/auth/verify-otp')
    .send({ email, code: otp.code })
    .expect(201)

  return {
    user,
    accessToken: verifyRes.body.accessToken as string,
    cookie: (verifyRes.headers['set-cookie'][0] as string).split(';')[0],
  }
}

describe('Change password (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-changepw-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('changes password, clears the refresh cookie, and dead-ends the old cookie', async () => {
    const email = `${prefix}happy@example.com`
    try {
      const { accessToken, cookie } = await registerAndVerify(app, email, password)

      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: password, newPassword: 'newpassword123' })
        .expect(200)

      expect(res.body.message).toBeDefined()
      const clearedCookie = res.headers['set-cookie']?.[0]
      expect(clearedCookie).toMatch(/^mnemra_rt=;/)

      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401)

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'newpassword123' })
        .expect(200)
    } finally {
      await cleanupUserByEmail(email)
    }
  })

  it('rejects the wrong current password with 401', async () => {
    const email = `${prefix}wrong@example.com`
    try {
      const { accessToken } = await registerAndVerify(app, email, password)

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'totally-wrong', newPassword: 'newpassword123' })
        .expect(401)
    } finally {
      await cleanupUserByEmail(email)
    }
  })

  it('rejects a new password under 8 characters with 400', async () => {
    const email = `${prefix}weak@example.com`
    try {
      const { accessToken } = await registerAndVerify(app, email, password)

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: password, newPassword: 'short' })
        .expect(400)
    } finally {
      await cleanupUserByEmail(email)
    }
  })

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: password, newPassword: 'newpassword123' })
      .expect(401)
  })
})
