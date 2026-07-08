import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import {
  chatMessages,
  chatQueryMetrics,
  chatSessions,
  db,
  documentReviewFlags,
  documents,
  faqDrafts,
  knowledgeBases,
  pool,
  tickets,
  users,
  workspaceEvents,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { DigestContentService } from './digest-content.service'
import { CoverageDashboardService } from './coverage-dashboard.service'

describe('DigestContentService', () => {
  let service: DigestContentService
  const prefix = `digest-content-spec-${Date.now()}-`
  let workspaceId: string
  let documentId: string
  let userId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    userId = user.id
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id

    const [kb] = await db.insert(knowledgeBases).values({ workspaceId, name: prefix }).returning()
    const [document] = await db
      .insert(documents)
      .values({ workspaceId, knowledgeBaseId: kb.id, title: 'doc', status: 'done' })
      .returning()
    documentId = document.id
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    const redis = { get: jest.fn().mockResolvedValue(null) }
    service = new DigestContentService(new CoverageDashboardService(redis as unknown as never))
    await db.delete(workspaceEvents).where(eq(workspaceEvents.workspaceId, workspaceId))
    await db.delete(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
    await db.delete(faqDrafts).where(eq(faqDrafts.workspaceId, workspaceId))
    await db.delete(tickets).where(eq(tickets.workspaceId, workspaceId))
    await db.delete(chatQueryMetrics).where(eq(chatQueryMetrics.workspaceId, workspaceId))
  })

  it('returns all-zero content for a quiet workspace', async () => {
    const content = await service.build(workspaceId)

    expect(content.eventCounts).toEqual({})
    expect(content.newFreshnessFlags).toBe(0)
    expect(content.newFaqDrafts).toBe(0)
    expect(content.newTickets).toBe(0)
    expect(content.chatSummary.totalQueries).toBe(0)
  })

  it('aggregates events, flags, drafts, tickets, and chat summary together', async () => {
    await db.insert(workspaceEvents).values([
      { workspaceId, type: 'document_ingested', entityId: documentId, title: 'doc 1' },
      { workspaceId, type: 'document_ingested', entityId: documentId, title: 'doc 2' },
      { workspaceId, type: 'ticket_extracted', entityId: documentId, title: 'ticket 1' },
    ])
    await db.insert(documentReviewFlags).values({ workspaceId, documentId, reason: 'ticket-mismatch' })
    await db.insert(faqDrafts).values({
      workspaceId,
      question: 'q',
      answer: 'a',
      ticketIds: ['t1'],
      clusterSize: 3,
      status: 'pending',
    })
    await db.insert(tickets).values({
      workspaceId,
      transcript: 't',
      transcriptHash: randomUUID(),
      status: 'done',
    })

    const [session] = await db
      .insert(chatSessions)
      .values({ workspaceId, userId, title: 's' })
      .returning()
    const [message] = await db
      .insert(chatMessages)
      .values({ sessionId: session.id, role: 'assistant', content: 'a' })
      .returning()
    await db.insert(chatQueryMetrics).values({
      workspaceId,
      sessionId: session.id,
      chatMessageId: message.id,
      question: 'q',
      isFallback: false,
      cacheStatus: 'miss',
      queryClass: 'complex',
      topScore: 0.9,
      latencyMs: 100,
    })

    const content = await service.build(workspaceId)

    expect(content.eventCounts).toEqual({ document_ingested: 2, ticket_extracted: 1 })
    expect(content.newFreshnessFlags).toBe(1)
    expect(content.newFaqDrafts).toBe(1)
    expect(content.newTickets).toBe(1)
    expect(content.chatSummary.totalQueries).toBe(1)
  })
})
