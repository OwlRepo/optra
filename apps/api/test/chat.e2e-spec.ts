import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
import request from 'supertest'
import { answerQuestion, embedQuery } from '@repo/ai'
import {
  chatCache,
  chatMessages,
  chatSessions,
  db,
  documents,
  knowledgeBases,
  otps,
  pool,
  refreshTokens,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { DocumentsService } from '../src/documents/documents.service'

jest.mock('@repo/ai', () => ({
  answerQuestion: jest.fn(),
  countTokens: jest.fn((text: string) => text.length),
  embedQuery: jest.fn(),
}))

async function cleanupUsers(prefix: string) {
  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(chatCache).where(eq(chatCache.workspaceId, membership.workspaceId))
      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
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

describe('Chat flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-chat-${Date.now()}-`
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

  it('streams plain text, creates session history, lists sessions/messages, forbids foreign access, validates message', async () => {
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const coworker = await registerAndVerify(app, `${prefix}coworker@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const memberMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = memberMine.body[0].id as string

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: coworker.user.id,
      role: 'member',
    })

    ;(embedQuery as jest.Mock).mockResolvedValue([0.1, 0.2, 0.3])
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [{ documentId: 'doc-1', title: 'Doc One', sourceUrl: null, score: 0.8, snippet: 'snippet' }],
      stream: (async function* () {
        yield 'hello '
        yield 'world'
      })(),
    })

    const okRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'What is policy?' })
      .expect(201)

    expect(okRes.headers['content-type']).toContain('text/plain')
    expect(okRes.headers['x-chat-sources']).toBeDefined()
    expect(okRes.headers['x-chat-session-id']).toBeDefined()
    expect(okRes.headers['x-chat-cache']).toBe('miss')
    expect(okRes.text).toBe('hello world')

    const sessionId = okRes.headers['x-chat-session-id'] as string
    const sessionsRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/chat/sessions`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(sessionsRes.body).toHaveLength(1)
    expect(sessionsRes.body[0].id).toBe(sessionId)

    const messagesRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(messagesRes.body).toHaveLength(2)
    expect(messagesRes.body[0].role).toBe('user')
    expect(messagesRes.body[1].role).toBe('assistant')
    expect(messagesRes.body[1].sources).toEqual([
      { documentId: 'doc-1', title: 'Doc One', sourceUrl: null, score: 0.8, snippet: 'snippet' },
    ])

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${coworker.accessToken}`)
      .expect(404)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ message: 'What is policy?' })
      .expect(403)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: '' })
      .expect(400)

    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1)
    const persisted = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId))

    expect(session).toBeDefined()
    expect(persisted).toHaveLength(2)
  })

  it('serves repeat question from cache, then invalidates after KB mutation', async () => {
    const member = await registerAndVerify(app, `${prefix}cache@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body[0].id as string

    ;(embedQuery as jest.Mock).mockResolvedValue([0.9, 0.8, 0.7])
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'cached once'
      })(),
    })

    const first = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'Repeat me' })
      .expect(201)

    const second = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'Repeat me' })
      .expect(201)

    expect(first.headers['x-chat-cache']).toBe('miss')
    expect(second.headers['x-chat-cache']).toBe('exact')
    expect(answerQuestion).toHaveBeenCalledTimes(1)

    const [knowledgeBase] = await db
      .insert(knowledgeBases)
      .values({ workspaceId, name: 'Cache KB' })
      .returning()
    const [document] = await db
      .insert(documents)
      .values({
        workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        title: 'new.txt',
        status: 'done',
        storageKey: `${workspaceId}/${knowledgeBase.id}/new.txt`,
      })
      .returning()

    await app.get(DocumentsService).remove(workspaceId, knowledgeBase.id, document.id)

    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'recomputed'
      })(),
    })

    const third = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'Repeat me' })
      .expect(201)

    expect(third.headers['x-chat-cache']).toBe('miss')
    expect(answerQuestion).toHaveBeenCalledTimes(2)
  })

  it('returns 429 after exceeding per-user chat rate limit', async () => {
    const member = await registerAndVerify(app, `${prefix}ratelimit@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body[0].id as string

    ;(embedQuery as jest.Mock).mockResolvedValue([0.1, 0.2])
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'ok'
      })(),
    })

    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/chat`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ message: `Rate limit ${i}` })
        .expect(201)
    }

    const blocked = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'Rate limit final' })
      .expect(429)

    expect(blocked.body.message).toBe('Rate limit exceeded')
  })
})
