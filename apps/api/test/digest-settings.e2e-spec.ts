import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, tickets, users, workspaceEvents, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'

// The preview renders exactly what the weekly digest would send, so it is the
// observable face of SUPPORT_SURFACES_ENABLED for the digest.
const SUPPORT_LINES = /documents ingested|tickets|chat questions|FAQ drafts|possibly stale|crawls/

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(workspaceEvents).where(eq(workspaceEvents.workspaceId, membership.workspaceId))
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))
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

  return { user, accessToken: verifyRes.body.accessToken as string }
}

describe('Digest preview (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-digest-${Date.now()}-`
  const password = 'password123'
  const originalFlag = process.env.SUPPORT_SURFACES_ENABLED
  let ownerToken: string
  let memberToken: string
  let outsiderToken: string
  let workspaceId: string

  const preview = (token: string) =>
    request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/digest-settings/preview`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()

    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)
    ownerToken = owner.accessToken
    memberToken = member.accessToken
    outsiderToken = outsider.accessToken

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, owner.user.id)).limit(1)
    workspaceId = workspace.id
    await db.insert(workspaceMembers).values({ workspaceId, userId: member.user.id, role: 'member' })
    await db.insert(workspaceEvents).values([
      { workspaceId, type: 'document_ingested', entityId: workspaceId, title: 'Imported onboarding doc' },
      { workspaceId, type: 'ticket_extracted', entityId: workspaceId, title: 'Login ticket' },
      { workspaceId, type: 'comparison_flagged', entityId: workspaceId, title: 'PO-1 vs INV-1' },
    ])
    await db.insert(tickets).values({ workspaceId, transcript: 't', transcriptHash: randomUUID(), status: 'done' })
  })

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SUPPORT_SURFACES_ENABLED
    else process.env.SUPPORT_SURFACES_ENABLED = originalFlag
  })

  afterAll(async () => {
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('error: a user outside the workspace gets 403', async () => {
    await preview(outsiderToken).expect(403)
  })

  it('error: a plain member gets 403, the preview is owner/admin only', async () => {
    await preview(memberToken).expect(403)
  })

  it('edge: with support surfaces off, the preview lists comparisons and nothing about documents, tickets or chat', async () => {
    delete process.env.SUPPORT_SURFACES_ENABLED

    const res = await preview(ownerToken).expect(200)

    expect(res.body.slackPayload.text).toContain('1 comparisons with discrepancies')
    expect(res.body.slackPayload.text).not.toMatch(SUPPORT_LINES)
    expect(res.body.emailHtml).toContain('<li>1 comparisons with discrepancies</li>')
    expect(res.body.emailHtml).not.toMatch(SUPPORT_LINES)
  })

  it('regression: with SUPPORT_SURFACES_ENABLED=true the preview still lists documents and tickets', async () => {
    process.env.SUPPORT_SURFACES_ENABLED = 'true'

    const res = await preview(ownerToken).expect(200)

    expect(res.body.slackPayload.text).toContain('1 documents ingested')
    expect(res.body.slackPayload.text).toContain('1 tickets extracted')
    expect(res.body.slackPayload.text).toContain('1 new tickets')
    expect(res.body.slackPayload.text).toContain('1 comparisons with discrepancies')
  })
})
