import { INestApplication, ValidationPipe } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
import request from 'supertest'
import {
  db,
  invitations,
  knowledgeBases,
  otps,
  pool,
  refreshTokens,
  scrapeRuns,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id, email: users.email }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(scrapeRuns).where(eq(scrapeRuns.workspaceId, membership.workspaceId))
      await db.delete(invitations).where(eq(invitations.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function registerAndVerify(app: INestApplication, email: string, password: string) {
  const ipSuffix = Math.max(
    1,
    [...email].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 250,
  )

  await request(app.getHttpServer())
    .post('/auth/register')
    .set('X-Forwarded-For', `198.51.100.${ipSuffix}`)
    .send({ email, password })
    .expect(201)

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

  const verifyRes = await request(app.getHttpServer())
    .post('/auth/verify-otp')
    .set('X-Forwarded-For', `198.51.100.${ipSuffix}`)
    .send({ email, code: otp.code })
    .expect(201)

  return {
    user,
    accessToken: verifyRes.body.accessToken as string,
  }
}

describe('Scrape flow (e2e)', () => {
  let app: INestApplication
  let queue: { add: jest.Mock }
  let reusableOwner: { accessToken: string; workspaceId: string } | null = null
  const prefix = `e2e-scrape-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      process: jest.fn(),
      on: jest.fn(),
      isReady: jest.fn().mockResolvedValue(true),
    } as any

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken('scrape-queue'))
      .useValue(queue)
      .compile()

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

  it('owner/admin can enqueue scrape, member forbidden, cross-workspace kb 404, member can list runs', async () => {
    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const admin = await registerAndVerify(app, `${prefix}admin@example.com`, password)
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const ownerWorkspaceId = ownerMine.body[0].id as string
    reusableOwner = { accessToken: owner.accessToken, workspaceId: ownerWorkspaceId }

    const outsiderMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(200)
    const outsiderWorkspaceId = outsiderMine.body[0].id as string

    const kbRes = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Scrape KB' })
      .expect(201)
    const kbId = kbRes.body.id as string

    for (const invitee of [admin.user.email, member.user.email]) {
      await request(app.getHttpServer())
        .post(`/workspaces/${ownerWorkspaceId}/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitee })
        .expect(201)

      const [invite] = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.workspaceId, ownerWorkspaceId), eq(invitations.email, invitee)))
        .limit(1)

      const token = invitee === admin.user.email ? admin.accessToken : member.accessToken
      await request(app.getHttpServer())
        .post(`/workspaces/accept-invite/${invite.token}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    }

    await db
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, ownerWorkspaceId), eq(workspaceMembers.userId, admin.user.id)))

    const ownerStart = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/scrape`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ url: 'https://example.com/docs', maxDepth: 2, maxPages: 5 })
      .expect(202)

    expect(ownerStart.body.status).toBe('queued')
    expect(queue.add).toHaveBeenCalledTimes(1)

    const [queuedRun] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, ownerStart.body.runId)).limit(1)
    expect(queuedRun).toBeDefined()
    expect(queuedRun.status).toBe('queued')

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/scrape`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ url: 'https://example.com/docs' })
      .expect(403)

    const outsiderKbRes = await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ name: 'Other KB' })
      .expect(201)

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${outsiderKbRes.body.id}/scrape`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ url: 'https://example.com/docs' })
      .expect(404)

    const runsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/scrape-runs`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(runsRes.body).toHaveLength(1)
    expect(runsRes.body[0].id).toBe(ownerStart.body.runId)
  })

  it('returns the same run when the same crawl is started twice while it is still in flight', async () => {
    const owner = await registerAndVerify(app, `${prefix}dup-owner@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body[0].id as string

    const kbRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Duplicate Crawl KB' })
      .expect(201)
    const kbId = kbRes.body.id as string

    const first = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ url: 'https://example.com/docs', maxDepth: 2, maxPages: 5 })
      .expect(202)

    const second = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases/${kbId}/scrape`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ url: 'https://example.com/docs', maxDepth: 2, maxPages: 5 })
      .expect(200)

    expect(second.body).toEqual(first.body)
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('derives subtree scope for non-root seeds when includePrefixes is omitted', async () => {
    if (!reusableOwner) {
      throw new Error('Reusable scrape owner missing')
    }

    const kbRes = await request(app.getHttpServer())
      .post(`/workspaces/${reusableOwner.workspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${reusableOwner.accessToken}`)
      .send({ name: 'Scope Crawl KB' })
      .expect(201)
    const kbId = kbRes.body.id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${reusableOwner.workspaceId}/knowledge-bases/${kbId}/scrape`)
      .set('Authorization', `Bearer ${reusableOwner.accessToken}`)
      .send({ url: 'https://example.com/docs/article-a', maxDepth: 2, maxPages: 5 })
      .expect(202)

    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        includePrefixes: ['/docs/article-a'],
      }),
      expect.any(Object),
    )
  })
})
