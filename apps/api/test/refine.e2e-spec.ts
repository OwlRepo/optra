import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { RefineEmptyError, RefineRefusalError, refineMessage } from '@repo/ai'
import {
  db,
  otps,
  pool,
  refreshTokens,
  savedRefinedMessages,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'

jest.mock('@repo/ai', () => ({
  refineMessage: jest.fn(),
  RefineEmptyError: class RefineEmptyError extends Error {},
  RefineRefusalError: class RefineRefusalError extends Error {},
}))

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(savedRefinedMessages).where(eq(savedRefinedMessages.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(savedRefinedMessages).where(eq(savedRefinedMessages.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
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
  }
}

describe('Refine flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-refine-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('refines a message, forbids non-members, validates input, maps chain errors, saves and lists scoped to caller', async () => {
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body.items[0].id as string

    ;(refineMessage as jest.Mock).mockResolvedValue('Clean refined question')

    const refineRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'raw messy question' })
      .expect(201)

    expect(refineRes.body).toEqual({ original: 'raw messy question', refined: 'Clean refined question' })

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ text: 'raw messy question' })
      .expect(403)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: '' })
      .expect(400)

    ;(refineMessage as jest.Mock).mockRejectedValueOnce(new RefineEmptyError())
    const emptyRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'produces empty output' })
      .expect(422)
    expect(emptyRes.body.message).toMatch(/try rephrasing/i)

    ;(refineMessage as jest.Mock).mockRejectedValueOnce(new RefineRefusalError())
    const refusalRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'triggers a refusal' })
      .expect(422)
    expect(refusalRes.body.message).toMatch(/try rephrasing/i)

    const statusRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/status`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(statusRes.body.used).toBeGreaterThanOrEqual(1)
    expect(statusRes.body.limit).toBeGreaterThan(0)
    expect(statusRes.body.remaining).toBe(statusRes.body.limit - statusRes.body.used)

    const saveRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ originalText: 'raw messy question', refinedText: 'Clean refined question' })
      .expect(201)
    expect(saveRes.body.id).toBeDefined()
    expect(saveRes.body.originalText).toBe('raw messy question')
    expect(saveRes.body.refinedText).toBe('Clean refined question')

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(listRes.body.items).toHaveLength(1)
    expect(listRes.body.items[0].refinedText).toBe('Clean refined question')

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)
  })

  it('returns 429 after exceeding the daily refine limit', async () => {
    const member = await registerAndVerify(app, `${prefix}ratelimit@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body.items[0].id as string

    ;(refineMessage as jest.Mock).mockResolvedValue('ok')

    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/refine`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ text: `Refine me ${i}` })
        .expect(201)
    }

    const blocked = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'Refine me final' })
      .expect(429)

    expect(blocked.body.message).toBe('Daily refine limit reached')
  })
})
