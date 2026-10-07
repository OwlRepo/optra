import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
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
  usageEvents,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { DocumentsService } from '../src/documents/documents.service'

jest.mock('@repo/ai', () => ({
  answerQuestion: jest.fn(),
  classifyQuery: jest.fn(() => 'complex'),
  // Mirrors the unit spec's factory (chat.service.spec.ts). Omitting it made
  // ChatService throw "classifyStructuredIntent is not a function", which the
  // controller swallowed into a 201 with no headers at all - so the assertions
  // failed on `undefined` headers rather than on the real TypeError.
  classifyStructuredIntent: jest.fn(() => false),
  condenseQuestion: jest.fn((question: string) => Promise.resolve(question)),
  countTokens: jest.fn((text: string) => text.length),
  embedQuery: jest.fn(),
  boundHistory: jest.fn((turns: unknown[]) => turns),
  historyCondenseEnabled: jest.fn(() => true),
  historyInAnswerEnabled: jest.fn(() => true),
  historyMaxMessages: jest.fn(() => 12),
  // UsageService.metered() constructs a real meter for condense/structured calls,
  // and the billing ledger reads its token split and cost: a minimal stand-in
  // priced like gpt-4o ($2.50 / $10 per 1M tokens) so the e2e can assert rows.
  TokenMeter: class {
    private input = 0
    private output = 0
    private model: string | null = null
    record(response: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } | null, model?: string): void {
      const usage = response?.usage_metadata
      if (!usage) return
      this.input += usage.input_tokens ?? 0
      this.output += usage.output_tokens ?? 0
      if (model) this.model = model
    }
    get total(): number {
      return this.input + this.output
    }
    get inputTokens(): number {
      return this.input
    }
    get outputTokens(): number {
      return this.output
    }
    get costMicroUsd(): number {
      return Math.ceil(this.input * 2.5 + this.output * 10)
    }
    get dominantModel(): string | null {
      return this.model
    }
  },
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
    const workspaceId = memberMine.body.items[0].id as string

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
      .query({ pageSize: 1 })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(sessionsRes.body.items).toHaveLength(1)
    expect(sessionsRes.body.items[0].id).toBe(sessionId)
    expect(sessionsRes.body.totalPages).toBe(1)

    const messagesRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`)
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(messagesRes.body.items).toHaveLength(1)
    expect(messagesRes.body.items[0].role).toBe('user')
    expect(messagesRes.body.nextCursor).toEqual(expect.any(String))

    const messagesNextRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/chat/sessions/${sessionId}/messages`)
      .query({ limit: 1, cursor: messagesRes.body.nextCursor })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(messagesNextRes.body.items).toHaveLength(1)
    expect(messagesNextRes.body.items[0].role).toBe('assistant')
    expect(messagesNextRes.body.items[0].sources).toEqual([
      { documentId: 'doc-1', title: 'Doc One', sourceUrl: null, score: 0.8, snippet: 'snippet' },
    ])
    expect(messagesNextRes.body.nextCursor).toBeNull()

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

    // Multi-turn: a follow-up in the SAME session should receive the first
    // turn's content as history. This verifies wiring end-to-end through the
    // real HTTP -> controller -> service -> @repo/ai boundary; prompt/
    // condensation content itself is exclusively unit-tested inside
    // packages/ai, since @repo/ai is wholesale-mocked at this layer.
    ;(answerQuestion as jest.Mock).mockResolvedValueOnce({
      sources: [],
      stream: (async function* () {
        yield 'hello '
        yield 'world'
      })(),
    })

    const followUpRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/chat`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ message: 'Can you say more about that?', sessionId })
      .expect(201)

    expect(followUpRes.text).toBe('hello world')
    expect(answerQuestion).toHaveBeenCalledTimes(2)
    // answerQuestion(question, workspaceId, limit, embedding, filters, history)
    // — history is the 6th positional argument.
    expect((answerQuestion as jest.Mock).mock.calls[0][5]).toEqual([])
    expect((answerQuestion as jest.Mock).mock.calls[1][5]).toEqual([
      { role: 'user', content: 'What is policy?' },
      { role: 'assistant', content: 'hello world' },
    ])
  })

  it('serves repeat question from cache, then invalidates after KB mutation', async () => {
    const member = await registerAndVerify(app, `${prefix}cache@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body.items[0].id as string

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
    const workspaceId = mine.body.items[0].id as string

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

  describe('billing metering (S4)', () => {
    const DAY = 24 * 60 * 60 * 1000
    const USAGE = { usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }

    // Registration is capped at 5 per 10 minutes and this file already spends it.
    async function seedOwnerWithWorkspace(email: string, trial: boolean) {
      const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
      const [workspace] = await db
        .insert(workspaces)
        .values({ name: 'S4 Chat', ownerId: user.id, trialEndsAt: trial ? new Date(Date.now() + 5 * DAY) : null })
        .returning()
      await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
      return { workspaceId: workspace.id, accessToken: app.get(JwtService).sign({ sub: user.id, email }) }
    }

    async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
      const previous: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key]
        process.env[key] = value
      }
      try {
        return await fn()
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    }

    const ledgerOf = (workspaceId: string) =>
      db.select().from(usageEvents).where(eq(usageEvents.workspaceId, workspaceId))

    const ask = (owner: { workspaceId: string; accessToken: string }, message: string) =>
      request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/chat`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ message })

    function answerWithUsage() {
      (embedQuery as jest.Mock).mockResolvedValue([0.4, 0.5, 0.6])
      ;(answerQuestion as jest.Mock).mockImplementation(
        async (_q: string, _ws: string, _limit: unknown, _embedding: unknown, _filters: unknown, _history: unknown, meter: { record: (r: unknown, m?: string) => void }) => ({
          sources: [],
          isFallback: false,
          stream: (async function* () {
            // The trailing stream chunk is what carries the provider's usage.
            meter.record(USAGE, 'gpt-4o')
            yield 'metered answer'
          })(),
        }),
      )
    }

    it('error: state none gets 402 SUBSCRIPTION_REQUIRED with a code and no chat headers', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-none@example.com`, false)
      answerWithUsage()

      const res = await withEnv({ BILLING_ENFORCEMENT: 'on' }, () => ask(owner, 'Is my plan active?').expect(402))

      expect(res.body).toMatchObject({ statusCode: 402, code: 'SUBSCRIPTION_REQUIRED' })
      expect(res.headers['x-chat-session-id']).toBeUndefined()
      expect(res.headers['x-chat-cache']).toBeUndefined()
      expect(answerQuestion).not.toHaveBeenCalled()
    })

    it('error: AI cost at the cap gets 402 AI_BUDGET_EXCEEDED', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-cap@example.com`, true)
      await db.insert(usageEvents).values({
        workspaceId: owner.workspaceId,
        kind: 'llm_cost',
        quantity: 4_000_000,
        idempotencyKey: `e2e-seed:${Math.random().toString(36).slice(2)}`,
        occurredAt: new Date(),
      })
      answerWithUsage()

      const res = await withEnv({ BILLING_ENFORCEMENT: 'on' }, () => ask(owner, 'Am I over my cap?').expect(402))

      expect(res.body).toMatchObject({ statusCode: 402, code: 'AI_BUDGET_EXCEEDED' })
      expect(answerQuestion).not.toHaveBeenCalled()
    })

    it('edge: with enforcement off the legacy token-limit 402 has no code', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-legacy@example.com`, false)
      answerWithUsage()

      const res = await withEnv({ BILLING_ENFORCEMENT: 'off', MAX_TOKENS_PER_WORKSPACE_MONTH: '0' }, () =>
        ask(owner, 'Legacy limit please').expect(402),
      )

      expect(res.body.message).toBe('Workspace monthly token budget reached')
      expect(res.body.code).toBeUndefined()
      expect(await ledgerOf(owner.workspaceId)).toHaveLength(0)
    })

    it('happy: an answered chat writes an llm_cost row after the stream ends', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-ok@example.com`, true)
      answerWithUsage()

      const res = await withEnv({ BILLING_ENFORCEMENT: 'on' }, () => ask(owner, 'Meter this answer').expect(201))

      expect(res.text).toBe('metered answer')
      const rows = await ledgerOf(owner.workspaceId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'llm_cost', quantity: 7500, inputTokens: 1000, outputTokens: 500, model: 'gpt-4o' })
    })
  })
})
