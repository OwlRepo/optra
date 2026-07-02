import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
import { similaritySearch } from '@repo/ai'
import {
  chatMessages,
  chatSessions,
  db,
  documents,
  knowledgeBases,
  pool,
  tickets,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { SearchService } from './search.service'

jest.mock('@repo/ai', () => ({
  similaritySearch: jest.fn(),
}))

async function cleanupSearchFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(chatSessions).where(eq(chatSessions.workspaceId, membership.workspaceId))
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))

      const workspaceKnowledgeBases = await db
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.workspaceId, membership.workspaceId))

      for (const knowledgeBase of workspaceKnowledgeBases) {
        await db.delete(documents).where(eq(documents.knowledgeBaseId, knowledgeBase.id))
      }

      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(prefix: string, label: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${prefix}${label}-${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Search Spec ${label}`, ownerId: user.id })
    .returning()

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })

  return { user, workspace }
}

describe('SearchService', () => {
  let service: SearchService
  const prefix = `search-service-spec-${Date.now()}-`

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SearchService],
    }).compile()

    service = moduleRef.get(SearchService)
  })

  afterEach(() => {
    jest.clearAllMocks()
    ;(similaritySearch as jest.Mock).mockResolvedValue([])
  })

  afterAll(async () => {
    await cleanupSearchFixtures(prefix)
    await pool.end()
  })

  it('returns document results for matching chunks and excludes documents from other workspaces', async () => {
    const mine = await seedWorkspaceFixture(prefix, 'docs-mine')
    const other = await seedWorkspaceFixture(prefix, 'docs-other')

    const [myKnowledgeBase] = await db
      .insert(knowledgeBases)
      .values({ workspaceId: mine.workspace.id, name: 'Mine KB' })
      .returning()
    const [otherKnowledgeBase] = await db
      .insert(knowledgeBases)
      .values({ workspaceId: other.workspace.id, name: 'Other KB' })
      .returning()

    const [myDocument] = await db
      .insert(documents)
      .values({
        workspaceId: mine.workspace.id,
        knowledgeBaseId: myKnowledgeBase.id,
        title: 'OTP Runbook',
      })
      .returning()
    const [otherDocument] = await db
      .insert(documents)
      .values({
        workspaceId: other.workspace.id,
        knowledgeBaseId: otherKnowledgeBase.id,
        title: 'Other OTP Runbook',
      })
      .returning()

    ;(similaritySearch as jest.Mock).mockResolvedValue([
      {
        id: randomUUID(),
        content: 'OTP fix snippet',
        metadata: { documentId: myDocument.id },
        score: 0.93,
      },
      {
        id: randomUUID(),
        content: 'Should stay hidden',
        metadata: { documentId: otherDocument.id },
        score: 0.91,
      },
    ])

    const result = await service.search(mine.workspace.id, 'otp')

    expect(similaritySearch).toHaveBeenCalledWith('otp', mine.workspace.id, 5)
    expect(result.documents).toEqual([
      {
        documentId: myDocument.id,
        knowledgeBaseId: myKnowledgeBase.id,
        title: 'OTP Runbook',
        snippet: 'OTP fix snippet',
        score: 0.93,
      },
    ])
  })

  it('returns ticket results scoped to workspace', async () => {
    const mine = await seedWorkspaceFixture(prefix, 'tickets-mine')
    const other = await seedWorkspaceFixture(prefix, 'tickets-other')

    await db.insert(tickets).values([
      {
        workspaceId: mine.workspace.id,
        transcript: 'mine transcript',
        transcriptHash: randomUUID().replace(/-/g, ''),
        title: 'OTP login loop',
        issueSummary: 'Customer stuck after OTP verify',
        status: 'done',
      },
      {
        workspaceId: other.workspace.id,
        transcript: 'other transcript',
        transcriptHash: randomUUID().replace(/-/g, ''),
        title: 'OTP login loop',
        issueSummary: 'Should not leak',
        status: 'done',
      },
    ])

    const result = await service.search(mine.workspace.id, 'otp')

    expect(result.tickets).toHaveLength(1)
    expect(result.tickets[0]?.title).toBe('OTP login loop')
    expect(result.tickets[0]?.snippet).toContain('Customer stuck after OTP verify')
  })

  it('returns chat message results scoped through chat_sessions workspace join', async () => {
    const mine = await seedWorkspaceFixture(prefix, 'chat-mine')
    const other = await seedWorkspaceFixture(prefix, 'chat-other')

    const [mySession] = await db
      .insert(chatSessions)
      .values({
        workspaceId: mine.workspace.id,
        userId: mine.user.id,
        title: 'Mine session',
      })
      .returning()
    const [otherSession] = await db
      .insert(chatSessions)
      .values({
        workspaceId: other.workspace.id,
        userId: other.user.id,
        title: 'Other session',
      })
      .returning()

    await db.insert(chatMessages).values([
      {
        sessionId: mySession.id,
        role: 'assistant',
        content: 'Use OTP backup code for login fix',
      },
      {
        sessionId: otherSession.id,
        role: 'assistant',
        content: 'Use OTP backup code but hide this workspace',
      },
    ])

    const result = await service.search(mine.workspace.id, 'backup code')

    expect(result.chatMessages).toHaveLength(1)
    expect(result.chatMessages[0]?.sessionId).toBe(mySession.id)
    expect(result.chatMessages[0]?.snippet).toContain('backup code')
  })

  it('returns empty grouped arrays when there are no matches', async () => {
    const mine = await seedWorkspaceFixture(prefix, 'empty')

    const result = await service.search(mine.workspace.id, 'no-match-term')

    expect(result).toEqual({ documents: [], tickets: [], chatMessages: [] })
  })

  it('returns empty grouped arrays for empty query without hitting DB or vector search', async () => {
    const mine = await seedWorkspaceFixture(prefix, 'blank')
    const executeSpy = jest.spyOn(db, 'execute')

    const result = await service.search(mine.workspace.id, '   ')

    expect(result).toEqual({ documents: [], tickets: [], chatMessages: [] })
    expect(similaritySearch).not.toHaveBeenCalled()
    expect(executeSpy).not.toHaveBeenCalled()
  })
})
