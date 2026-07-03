import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { and, asc, eq, like } from 'drizzle-orm'
import { answerQuestion, countTokens, embedQuery } from '@repo/ai'
import {
  chatMessages,
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

jest.mock('@repo/ai', () => ({
  answerQuestion: jest.fn(),
  countTokens: jest.fn(),
  embedQuery: jest.fn(),
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
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CacheService, useValue: cache },
        { provide: UsageService, useValue: usage },
      ],
    }).compile()

    service = moduleRef.get(ChatService)
  })

  afterEach(() => {
    jest.clearAllMocks()
    ;(countTokens as jest.Mock).mockImplementation((text: string) => text.length)
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
    expect(answerQuestion).toHaveBeenCalledWith('Hello assistant', workspace.id, undefined, [
      0.1, 0.2, 0.3,
    ])
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
    expect(mineSessions.nextCursor).toBeNull()

    const otherSessions = await service.listSessions(other.workspace.id, other.user.id, {})
    expect(otherSessions.items).toHaveLength(1)
    expect(otherSessions.items[0]?.id).toBe(otherSession.sessionId)
  })

  it('paginates chat sessions by updatedAt desc with cursor', async () => {
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

    const firstPage = await service.listSessions(mine.workspace.id, mine.user.id, { limit: 2 })

    expect(firstPage.items.map((session) => session.title)).toEqual(['Third question', 'Second question'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await service.listSessions(mine.workspace.id, mine.user.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    expect(secondPage.items.map((session) => session.title)).toEqual(['First question'])
    expect(secondPage.nextCursor).toBeNull()
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
})
