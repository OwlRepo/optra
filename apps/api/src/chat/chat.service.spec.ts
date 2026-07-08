import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { and, asc, eq, like } from 'drizzle-orm'
import {
  answerQuestion,
  classifyQuery,
  classifyStructuredIntent,
  condenseQuestion,
  countTokens,
  embedQuery,
  historyCondenseEnabled,
  historyInAnswerEnabled,
} from '@repo/ai'
import {
  chatMessages,
  chatQueryMetrics,
  chatSessions,
  db,
  pool,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { CacheService } from '../cache/cache.service'
import { ChatService } from './chat.service'
import { UsageService } from '../limits/usage.service'
import { StructuredQueryService } from '../structured-query/structured-query.service'

jest.mock('@repo/ai', () => ({
  answerQuestion: jest.fn(),
  classifyQuery: jest.fn(() => 'complex'),
  // Defaults false so every pre-existing test (none of which cares about
  // structured routing) keeps taking the original cache/RAG path unchanged.
  classifyStructuredIntent: jest.fn(() => false),
  condenseQuestion: jest.fn((question: string) => Promise.resolve(question)),
  countTokens: jest.fn(),
  embedQuery: jest.fn(),
  boundHistory: jest.fn((turns: unknown[]) => turns),
  historyCondenseEnabled: jest.fn(() => true),
  historyInAnswerEnabled: jest.fn(() => true),
  historyMaxMessages: jest.fn(() => 12),
}))

async function cleanupChatFixtures(prefix: string) {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`))

  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(chatSessions).where(eq(chatSessions.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(email: string, workspaceName: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: workspaceName, ownerId: user.id })
    .returning()

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })

  return { user, workspace }
}

describe('ChatService', () => {
  let service: ChatService
  let cache: {
    getExact: jest.Mock
    setExact: jest.Mock
    getSemantic: jest.Mock
    saveSemantic: jest.Mock
    getVersion: jest.Mock
  }
  let usage: {
    assertWithinBudget: jest.Mock
    addUsage: jest.Mock
  }
  let structuredQuery: {
    hasReadyDatasets: jest.Mock
    answer: jest.Mock
  }
  const prefix = `chat-service-spec-${Date.now()}-`

  beforeAll(async () => {
    cache = {
      getExact: jest.fn(),
      setExact: jest.fn(),
      getSemantic: jest.fn(),
      saveSemantic: jest.fn(),
      getVersion: jest.fn(),
    }
    usage = {
      assertWithinBudget: jest.fn(),
      addUsage: jest.fn(),
    }
    structuredQuery = {
      hasReadyDatasets: jest.fn(() => Promise.resolve(false)),
      answer: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CacheService, useValue: cache },
        { provide: UsageService, useValue: usage },
        { provide: StructuredQueryService, useValue: structuredQuery },
      ],
    }).compile()

    service = moduleRef.get(ChatService)
  })

  afterEach(() => {
    jest.clearAllMocks()
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(condenseQuestion as jest.Mock).mockImplementation((question: string) => Promise.resolve(question))
    ;(historyCondenseEnabled as jest.Mock).mockReturnValue(true)
    ;(historyInAnswerEnabled as jest.Mock).mockReturnValue(true)
    ;(classifyStructuredIntent as jest.Mock).mockReturnValue(false)
    structuredQuery.hasReadyDatasets.mockResolvedValue(false)
  })

  afterAll(async () => {
    await cleanupChatFixtures(prefix)
    await pool.end()
  })

  it('creates a session on first turn and persists user + assistant messages with sources', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}create@example.com`,
      'Chat Spec Create',
    )
    const stream = (async function* () {
      yield 'hello '
      yield 'world'
    })()
    const sources = [
      { documentId: 'doc-1', title: 'Doc', sourceUrl: null, score: 0.9, snippet: 'snippet' },
    ]
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.1, 0.2, 0.3])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({ sources, stream, isFallback: false })

    const result = await service.answer(workspace.id, user.id, 'Hello assistant')

    // The cache-lookup embedding is reused for retrieval (no second embed on miss).
    // First turn in a session has no history, so condensing is skipped entirely
    // (zero added cost) and the trailing history arg is an empty array.
    expect(condenseQuestion).not.toHaveBeenCalled()
    expect(answerQuestion).toHaveBeenCalledWith(
      'Hello assistant',
      workspace.id,
      undefined,
      [0.1, 0.2, 0.3],
      undefined,
      [],
    )
    expect(result.sessionId).toBeDefined()

    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }

    await result.onComplete(body.join(''))

    expect(embedQuery).toHaveBeenCalledWith('Hello assistant')
    expect(usage.assertWithinBudget).toHaveBeenCalledWith(workspace.id)
    expect(usage.addUsage).toHaveBeenCalledWith(
      workspace.id,
      'Hello assistant'.length + 'hello world'.length,
    )
    expect(cache.saveSemantic).toHaveBeenCalledWith(
      workspace.id,
      1,
      'Hello assistant',
      [0.1, 0.2, 0.3],
      'hello world',
      sources,
    )
    expect(cache.setExact).toHaveBeenCalledWith(workspace.id, 'Hello assistant', 'hello world', sources)
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, result.sessionId))
      .limit(1)
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, result.sessionId))
      .orderBy(asc(chatMessages.createdAt))

    expect(session.title).toBe('Hello assistant')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content).toBe('Hello assistant')
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[1]?.content).toBe('hello world')
    expect(messages[1]?.sources).toEqual(sources)
  })

  it('skips cache writes for fallback miss answers but still persists assistant message', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}fallback@example.com`,
      'Chat Spec Fallback',
    )
    const stream = (async function* () {
      yield "I don't have enough information to answer that."
    })()
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.1, 0.2, 0.3])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({ sources: [], stream, isFallback: true })

    const result = await service.answer(workspace.id, user.id, 'Unknown question')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }

    await result.onComplete(body.join(''))

    expect(cache.setExact).not.toHaveBeenCalled()
    expect(cache.saveSemantic).not.toHaveBeenCalled()
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, result.sessionId))
      .orderBy(asc(chatMessages.createdAt))

    expect(messages).toHaveLength(2)
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[1]?.content).toBe("I don't have enough information to answer that.")
  })

  it('reuses existing sessionId and scopes listSessions to user + workspace', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine@example.com`, 'Chat Spec Mine')
    const other = await seedWorkspaceFixture(`${prefix}other@example.com`, 'Chat Spec Other')
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.9])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    const existing = await service.answer(mine.workspace.id, mine.user.id, 'First turn')

    await existing.onComplete('first answer')

    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'second'
      })(),
      isFallback: false,
    })
    ;(embedQuery as jest.Mock).mockResolvedValue([0.7])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)

    const followUp = await service.answer(
      mine.workspace.id,
      mine.user.id,
      'Second turn',
      existing.sessionId,
    )
    for await (const _token of followUp.stream) {
    }
    await followUp.onComplete('second')

    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'other'
      })(),
      isFallback: false,
    })
    ;(embedQuery as jest.Mock).mockResolvedValue([0.5])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    const otherSession = await service.answer(other.workspace.id, other.user.id, 'Other turn')
    await otherSession.onComplete('other answer')

    expect(followUp.sessionId).toBe(existing.sessionId)

    const mineSessions = await service.listSessions(mine.workspace.id, mine.user.id, {})
    expect(mineSessions.items).toHaveLength(1)
    expect(mineSessions.items[0]?.id).toBe(existing.sessionId)
    expect(mineSessions.total).toBe(1)

    const otherSessions = await service.listSessions(other.workspace.id, other.user.id, {})
    expect(otherSessions.items).toHaveLength(1)
    expect(otherSessions.items[0]?.id).toBe(otherSession.sessionId)
  })

  it('paginates chat sessions newest-first, defaulting pageSize to 5', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}sessions-page@example.com`, 'Chat Spec Session Page')
    cache.getExact.mockResolvedValue({
      answer: 'cached exact',
      sources: [],
    })

    const first = await service.answer(mine.workspace.id, mine.user.id, 'First question')
    await first.onComplete('cached exact')
    const second = await service.answer(mine.workspace.id, mine.user.id, 'Second question')
    await second.onComplete('cached exact')
    const third = await service.answer(mine.workspace.id, mine.user.id, 'Third question')
    await third.onComplete('cached exact')

    await db.update(chatSessions).set({ updatedAt: new Date('2026-07-01T00:00:01.000Z') }).where(eq(chatSessions.id, first.sessionId))
    await db.update(chatSessions).set({ updatedAt: new Date('2026-07-01T00:00:02.000Z') }).where(eq(chatSessions.id, second.sessionId))
    await db.update(chatSessions).set({ updatedAt: new Date('2026-07-01T00:00:03.000Z') }).where(eq(chatSessions.id, third.sessionId))

    const defaultPage = await service.listSessions(mine.workspace.id, mine.user.id, {})
    expect(defaultPage.pageSize).toBe(5)
    expect(defaultPage.items.map((session) => session.title)).toEqual([
      'Third question',
      'Second question',
      'First question',
    ])

    const firstPage = await service.listSessions(mine.workspace.id, mine.user.id, { page: '1', pageSize: '2' })

    expect(firstPage.items.map((session) => session.title)).toEqual(['Third question', 'Second question'])
    expect(firstPage.total).toBe(3)
    expect(firstPage.totalPages).toBe(2)

    const secondPage = await service.listSessions(mine.workspace.id, mine.user.id, { page: '2', pageSize: '2' })

    expect(secondPage.items.map((session) => session.title)).toEqual(['First question'])
  })

  it('searches chat sessions by title', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}sessions-search@example.com`, 'Chat Spec Session Search')
    cache.getExact.mockResolvedValue({ answer: 'cached exact', sources: [] })

    const billing = await service.answer(mine.workspace.id, mine.user.id, 'Billing question about invoices')
    await billing.onComplete('cached exact')
    const refund = await service.answer(mine.workspace.id, mine.user.id, 'Refund question')
    await refund.onComplete('cached exact')

    const searched = await service.listSessions(mine.workspace.id, mine.user.id, { q: 'billing' })
    expect(searched.items.map((session) => session.id)).toEqual([billing.sessionId])
  })

  it('getMessages returns assistant sources and rejects foreign session access', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}messages@example.com`, 'Chat Spec Messages')
    const other = await seedWorkspaceFixture(`${prefix}messages-other@example.com`, 'Chat Spec Messages Other')

    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.4])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [{ documentId: 'doc-9', title: 'Doc Nine', sourceUrl: null, score: 0.7, snippet: 's' }],
      stream: (async function* () {
        yield 'answer'
      })(),
      isFallback: false,
    })

    const mineTurn = await service.answer(mine.workspace.id, mine.user.id, 'Need answer')
    for await (const _token of mineTurn.stream) {
    }
    await mineTurn.onComplete('answer')

    const messages = await service.getMessages(mine.workspace.id, mine.user.id, mineTurn.sessionId, {})
    expect(messages.items).toHaveLength(2)
    expect(messages.items[1]?.sources).toEqual([
      { documentId: 'doc-9', title: 'Doc Nine', sourceUrl: null, score: 0.7, snippet: 's' },
    ])
    expect(messages.nextCursor).toBeNull()

    await expect(
      service.getMessages(mine.workspace.id, other.user.id, mineTurn.sessionId, {}),
    ).rejects.toThrow(NotFoundException)

    const [dbSession] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, mineTurn.sessionId), eq(chatSessions.userId, mine.user.id)))
      .limit(1)
    expect(dbSession).toBeDefined()
  })

  it('paginates chat messages by createdAt asc with cursor', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}messages-page@example.com`, 'Chat Spec Message Page')

    cache.getExact.mockResolvedValue({
      answer: 'cached exact',
      sources: [],
    })

    const turn = await service.answer(mine.workspace.id, mine.user.id, 'Need answer')
    await turn.onComplete('cached exact')

    const inserted = await db
      .insert(chatMessages)
      .values([
        {
          sessionId: turn.sessionId,
          role: 'user',
          content: 'Older one',
          sources: null,
          createdAt: new Date('2026-07-01T00:00:01.000Z'),
        },
        {
          sessionId: turn.sessionId,
          role: 'assistant',
          content: 'Older two',
          sources: [],
          createdAt: new Date('2026-07-01T00:00:02.000Z'),
        },
        {
          sessionId: turn.sessionId,
          role: 'user',
          content: 'Older three',
          sources: null,
          createdAt: new Date('2026-07-01T00:00:03.000Z'),
        },
      ])
      .returning()

    const firstPage = await service.getMessages(mine.workspace.id, mine.user.id, turn.sessionId, {
      limit: 2,
    })

    expect(firstPage.items.map((message) => message.content)).toEqual(['Older one', 'Older two'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    await db
      .insert(chatMessages)
      .values({
        sessionId: turn.sessionId,
        role: 'assistant',
        content: 'Between page',
        sources: [],
        createdAt: new Date('2026-07-01T00:00:02.500Z'),
      })

    const secondPage = await service.getMessages(mine.workspace.id, mine.user.id, turn.sessionId, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    expect(secondPage.items.map((message) => message.content)).toEqual(['Between page', 'Older three'])
    expect(secondPage.items.map((message) => message.id)).not.toContain(inserted[0]?.id)
  })

  it('exact hit skips LLM and still persists assistant turn', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}exact@example.com`,
      'Chat Spec Exact',
    )
    cache.getExact.mockResolvedValue({
      answer: 'cached exact',
      sources: [{ documentId: 'doc-cache', title: 'Cache Doc', sourceUrl: null, score: 1, snippet: 'hit' }],
    })

    const result = await service.answer(workspace.id, user.id, 'Same question')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }
    await result.onComplete(body.join(''))

    expect(answerQuestion).not.toHaveBeenCalled()
    expect(embedQuery).not.toHaveBeenCalled()
    expect(usage.assertWithinBudget).not.toHaveBeenCalled()
    expect(usage.addUsage).not.toHaveBeenCalled()
    expect(body.join('')).toBe('cached exact')

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, result.sessionId))

    expect(messages[1]?.content).toBe('cached exact')
    expect(messages[1]?.sources).toEqual([
      { documentId: 'doc-cache', title: 'Cache Doc', sourceUrl: null, score: 1, snippet: 'hit' },
    ])
  })

  it('semantic hit back-fills exact cache and computes embedding once', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}semantic@example.com`,
      'Chat Spec Semantic',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue({
      answer: 'cached semantic',
      sources: [{ documentId: 'doc-sem', title: 'Sem Doc', sourceUrl: null, score: 0.96, snippet: 'sem' }],
    })
    ;(embedQuery as jest.Mock).mockResolvedValue([0.3, 0.4])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)

    const result = await service.answer(workspace.id, user.id, 'Paraphrase question')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }
    await result.onComplete(body.join(''))

    expect(embedQuery).toHaveBeenCalledTimes(1)
    expect(answerQuestion).not.toHaveBeenCalled()
    expect(usage.assertWithinBudget).not.toHaveBeenCalled()
    expect(usage.addUsage).not.toHaveBeenCalled()
    expect(cache.setExact).toHaveBeenCalledWith(
      workspace.id,
      'Paraphrase question',
      'cached semantic',
      [{ documentId: 'doc-sem', title: 'Sem Doc', sourceUrl: null, score: 0.96, snippet: 'sem' }],
    )
  })

  it('miss path checks budget before generation and records user+assistant tokens once complete', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}usage@example.com`,
      'Chat Spec Usage',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(2)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.2, 0.4])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'final answer'
      })(),
    })

    const result = await service.answer(workspace.id, user.id, 'Count these tokens')
    for await (const _token of result.stream) {
    }
    await result.onComplete('final answer')

    expect(usage.assertWithinBudget).toHaveBeenCalledWith(workspace.id)
    expect(usage.addUsage).toHaveBeenCalledWith(
      workspace.id,
      'Count these tokens'.length + 'final answer'.length,
    )
  })

  it('condenses a follow-up using prior turns and uses the condensed question for cache/embed/generation', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}condense@example.com`,
      'Chat Spec Condense',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.1])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'first answer'
      })(),
      isFallback: false,
    })

    const first = await service.answer(workspace.id, user.id, 'What is our refund policy?')
    for await (const _token of first.stream) {
      // drain
    }
    await first.onComplete('first answer')

    const condensed = 'How do I request a refund within the 30-day window?'
    ;(condenseQuestion as jest.Mock).mockResolvedValueOnce(condensed)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'second answer'
      })(),
      isFallback: false,
    })

    const second = await service.answer(
      workspace.id,
      user.id,
      'How do I request one?',
      first.sessionId,
    )
    for await (const _token of second.stream) {
      // drain
    }
    await second.onComplete('second answer')

    expect(condenseQuestion).toHaveBeenCalledTimes(1)
    const [passedQuestion, passedHistory] = (condenseQuestion as jest.Mock).mock.calls[0]
    expect(passedQuestion).toBe('How do I request one?')
    expect(passedHistory).toEqual([
      { role: 'user', content: 'What is our refund policy?' },
      { role: 'assistant', content: 'first answer' },
    ])

    // Cache/embed/generation all operate on the condensed standalone question,
    // not the raw follow-up text.
    expect(cache.getExact).toHaveBeenLastCalledWith(workspace.id, condensed)
    expect(embedQuery).toHaveBeenLastCalledWith(condensed)
    expect(answerQuestion).toHaveBeenLastCalledWith(
      condensed,
      workspace.id,
      undefined,
      [0.1],
      undefined,
      passedHistory,
    )

    // Usage accounting folds in the condensed-question length only because
    // condensing actually changed the text this turn.
    expect(usage.addUsage).toHaveBeenLastCalledWith(
      workspace.id,
      'How do I request one?'.length + 'second answer'.length + condensed.length,
    )
  })

  it('reproduces pre-history behavior exactly when both history flags are disabled, even with prior turns present', async () => {
    ;(historyCondenseEnabled as jest.Mock).mockReturnValue(false)
    ;(historyInAnswerEnabled as jest.Mock).mockReturnValue(false)

    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}flags-off@example.com`,
      'Chat Spec Flags Off',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.2])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'first answer'
      })(),
      isFallback: false,
    })

    const first = await service.answer(workspace.id, user.id, 'First turn')
    for await (const _token of first.stream) {
      // drain
    }
    await first.onComplete('first answer')

    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'second answer'
      })(),
      isFallback: false,
    })

    const second = await service.answer(workspace.id, user.id, 'Second turn', first.sessionId)
    for await (const _token of second.stream) {
      // drain
    }
    await second.onComplete('second answer')

    expect(condenseQuestion).not.toHaveBeenCalled()
    expect(answerQuestion).toHaveBeenLastCalledWith(
      'Second turn',
      workspace.id,
      undefined,
      [0.2],
      undefined,
      [],
    )
    expect(usage.addUsage).toHaveBeenLastCalledWith(
      workspace.id,
      'Second turn'.length + 'second answer'.length,
    )
  })

  it('records chat query metrics on a cache miss with topScore, source count, and the reused embedding', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}metrics-miss@example.com`,
      'Chat Spec Metrics Miss',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue(new Array(1536).fill(0.01))
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(classifyQuery as jest.Mock).mockReturnValue('complex')
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [
        { documentId: 'doc-a', title: 'A', sourceUrl: null, score: 0.4, snippet: 'a' },
        { documentId: 'doc-b', title: 'B', sourceUrl: null, score: 0.8, snippet: 'b' },
      ],
      stream: (async function* () {
        yield 'metrics answer'
      })(),
      isFallback: false,
    })

    const result = await service.answer(workspace.id, user.id, 'Which plan has the best uptime?')
    for await (const _token of result.stream) {
      // drain
    }
    await result.onComplete('metrics answer')

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))

    expect(metric).toBeDefined()
    expect(metric.workspaceId).toBe(workspace.id)
    expect(metric.cacheStatus).toBe('miss')
    expect(metric.queryClass).toBe('complex')
    expect(metric.isFallback).toBe(false)
    expect(metric.sourceCount).toBe(2)
    expect(metric.topScore).toBeCloseTo(0.8)
    expect(metric.questionEmbedding).not.toBeNull()
    expect(metric.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('records chat query metrics on an exact-cache hit without embedding the question', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}metrics-exact@example.com`,
      'Chat Spec Metrics Exact',
    )
    cache.getExact.mockResolvedValue({
      answer: 'cached exact',
      sources: [{ documentId: 'doc-cache', title: 'Cache Doc', sourceUrl: null, score: 1, snippet: 'hit' }],
    })

    const result = await service.answer(workspace.id, user.id, 'Same question')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }
    await result.onComplete(body.join(''))

    expect(embedQuery).not.toHaveBeenCalled()

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))

    expect(metric.cacheStatus).toBe('exact')
    expect(metric.isFallback).toBe(false)
    expect(metric.sourceCount).toBe(1)
    expect(metric.topScore).toBeCloseTo(1)
    expect(metric.questionEmbedding).toBeNull()
  })

  it('records chat query metrics on a semantic-cache hit reusing the already-computed embedding', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}metrics-semantic@example.com`,
      'Chat Spec Metrics Semantic',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue({
      answer: 'cached semantic',
      sources: [{ documentId: 'doc-sem', title: 'Sem Doc', sourceUrl: null, score: 0.7, snippet: 'sem' }],
    })
    ;(embedQuery as jest.Mock).mockResolvedValue(new Array(1536).fill(0.02))

    const result = await service.answer(workspace.id, user.id, 'Paraphrase for metrics')
    for await (const _token of result.stream) {
      // drain
    }
    await result.onComplete('cached semantic')

    expect(embedQuery).toHaveBeenCalledTimes(1)

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))

    expect(metric.cacheStatus).toBe('semantic')
    expect(metric.isFallback).toBe(false)
    expect(metric.questionEmbedding).not.toBeNull()
  })

  it('does not fail response persistence when chat query metrics recording throws', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}metrics-failure@example.com`,
      'Chat Spec Metrics Failure',
    )
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.1])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'resilient answer'
      })(),
      isFallback: false,
    })

    const recordSpy = jest
      .spyOn(service as unknown as { recordQueryMetrics: () => Promise<void> }, 'recordQueryMetrics')
      .mockRejectedValueOnce(new Error('boom'))

    const result = await service.answer(workspace.id, user.id, 'Resilience check')
    for await (const _token of result.stream) {
      // drain
    }

    await expect(result.onComplete('resilient answer')).resolves.toBeUndefined()

    expect(cache.setExact).toHaveBeenCalled()
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, result.sessionId))
    expect(messages[1]?.content).toBe('resilient answer')

    recordSpy.mockRestore()
  })

  it('routes to the structured pipeline before any cache lookup when intent matches and datasets are ready', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}structured-route@example.com`,
      'Chat Spec Structured Route',
    )
    ;(classifyStructuredIntent as jest.Mock).mockReturnValue(true)
    structuredQuery.hasReadyDatasets.mockResolvedValue(true)
    structuredQuery.answer.mockResolvedValue({
      state: 'confident',
      answer: '| product | total |\n| --- | --- |\n| Widget | 1000 |',
      datasetId: 'dataset-1',
      datasetName: 'Sales',
    })

    const result = await service.answer(workspace.id, user.id, 'total revenue by product')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }
    await result.onComplete(body.join(''))

    expect(structuredQuery.hasReadyDatasets).toHaveBeenCalledWith(workspace.id)
    expect(structuredQuery.answer).toHaveBeenCalledWith(workspace.id, 'total revenue by product')
    expect(cache.getExact).not.toHaveBeenCalled()
    expect(cache.getSemantic).not.toHaveBeenCalled()
    expect(embedQuery).not.toHaveBeenCalled()
    expect(answerQuestion).not.toHaveBeenCalled()
    expect(result.cacheStatus).toBe('structured')
    expect(result.structuredState).toBe('confident')

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))
    expect(metric.cacheStatus).toBe('structured')
    expect(metric.queryClass).toBe('structured')
    expect(metric.isFallback).toBe(false)
    expect(metric.sourceCount).toBe(1)
    expect(metric.topScore).toBeCloseTo(1)

    const [message] = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, result.sessionId), eq(chatMessages.role, 'assistant')))
    expect(message.sources).toEqual([
      {
        sourceType: 'dataset',
        datasetId: 'dataset-1',
        title: 'Sales',
        score: 1,
        snippet: 'Answered using this dataset via structured query.',
      },
    ])
  })

  it('cites every dataset joined by a cross-file comparison (V2 F5)', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}structured-compare@example.com`,
      'Chat Spec Structured Compare',
    )
    ;(classifyStructuredIntent as jest.Mock).mockReturnValue(true)
    structuredQuery.hasReadyDatasets.mockResolvedValue(true)
    structuredQuery.answer.mockResolvedValue({
      state: 'confident',
      answer: '| product | revenue | refund_amount |\n| --- | --- | --- |\n| Widget | 1000 | 100 |',
      datasets: [
        { id: 'dataset-1', name: 'Sales' },
        { id: 'dataset-2', name: 'Refunds' },
      ],
    })

    const result = await service.answer(workspace.id, user.id, 'compare sales vs refunds by product')
    const body: string[] = []
    for await (const token of result.stream) {
      body.push(token)
    }
    await result.onComplete(body.join(''))

    const [message] = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, result.sessionId), eq(chatMessages.role, 'assistant')))
    expect(message.sources).toEqual([
      {
        sourceType: 'dataset',
        datasetId: 'dataset-1',
        title: 'Sales',
        score: 1,
        snippet: 'Answered using this dataset via a cross-file structured query.',
      },
      {
        sourceType: 'dataset',
        datasetId: 'dataset-2',
        title: 'Refunds',
        score: 1,
        snippet: 'Answered using this dataset via a cross-file structured query.',
      },
    ])

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))
    expect(metric.sourceCount).toBe(2)
  })

  it('marks non-confident structured states as fallback in telemetry', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}structured-ambiguous@example.com`,
      'Chat Spec Structured Ambiguous',
    )
    ;(classifyStructuredIntent as jest.Mock).mockReturnValue(true)
    structuredQuery.hasReadyDatasets.mockResolvedValue(true)
    structuredQuery.answer.mockResolvedValue({
      state: 'ambiguous',
      answer: 'Which dataset did you mean?',
      candidates: [{ id: 'a', name: 'Sales', description: null }],
    })

    const result = await service.answer(workspace.id, user.id, 'compare totals')
    for await (const _token of result.stream) {
      // drain
    }
    await result.onComplete('Which dataset did you mean?')

    expect(result.structuredCandidates).toEqual([{ id: 'a', name: 'Sales', description: null }])

    const [metric] = await db
      .select()
      .from(chatQueryMetrics)
      .where(eq(chatQueryMetrics.sessionId, result.sessionId))
    expect(metric.isFallback).toBe(true)
  })

  it('falls through to the normal RAG path when structured intent matches but no datasets are ready', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}structured-no-datasets@example.com`,
      'Chat Spec Structured No Datasets',
    )
    ;(classifyStructuredIntent as jest.Mock).mockReturnValue(true)
    structuredQuery.hasReadyDatasets.mockResolvedValue(false)
    cache.getExact.mockResolvedValue(null)
    cache.getSemantic.mockResolvedValue(null)
    cache.getVersion.mockResolvedValue(1)
    usage.assertWithinBudget.mockResolvedValue(undefined)
    usage.addUsage.mockResolvedValue(undefined)
    ;(embedQuery as jest.Mock).mockResolvedValue([0.1])
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
    ;(answerQuestion as jest.Mock).mockResolvedValue({
      sources: [],
      stream: (async function* () {
        yield 'normal rag answer'
      })(),
      isFallback: false,
    })

    const result = await service.answer(workspace.id, user.id, 'total revenue by product')
    for await (const _token of result.stream) {
      // drain
    }
    await result.onComplete('normal rag answer')

    expect(structuredQuery.answer).not.toHaveBeenCalled()
    expect(answerQuestion).toHaveBeenCalled()
    expect(result.cacheStatus).toBe('miss')
  })
})
