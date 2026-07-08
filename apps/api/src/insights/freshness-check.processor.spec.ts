import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import {
  backgroundRuns,
  db,
  documentReviewFlags,
  documents,
  knowledgeBases,
  pool,
  tickets,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { FreshnessCheckProcessor } from './freshness-check.processor'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { BackgroundRunsService } from './background-runs.service'

describe('FreshnessCheckProcessor', () => {
  let coverage: { findGaps: jest.Mock }
  let runs: BackgroundRunsService
  let processor: FreshnessCheckProcessor
  const prefix = `freshness-processor-spec-${Date.now()}-`
  let workspaceId: string
  let documentId: string
  let ticketId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id
    const [kb] = await db.insert(knowledgeBases).values({ workspaceId, name: prefix }).returning()
    const [document] = await db
      .insert(documents)
      .values({ workspaceId, knowledgeBaseId: kb.id, title: 'doc', status: 'done' })
      .returning()
    documentId = document.id
    const [ticket] = await db
      .insert(tickets)
      .values({ workspaceId, transcript: 't', transcriptHash: randomUUID(), status: 'done' })
      .returning()
    ticketId = ticket.id
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    coverage = { findGaps: jest.fn() }
    runs = new BackgroundRunsService()
    processor = new FreshnessCheckProcessor(coverage as unknown as TicketDocCoverageService, runs)
    await db.delete(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
    await db.delete(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
  })

  it('inserts one flag per gap and records a succeeded run', async () => {
    coverage.findGaps.mockResolvedValue([{ documentId, ticketId, score: 0.2 }])

    await processor.onCheck({ data: { workspaceId } } as never)

    const flags = await db.select().from(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ documentId, ticketId, reason: 'ticket-mismatch', status: 'open' })

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
    expect(run.stats).toMatchObject({ flagsCreated: 1 })
  })

  it('records no flags and a succeeded run when there are no gaps', async () => {
    coverage.findGaps.mockResolvedValue([])

    await processor.onCheck({ data: { workspaceId } } as never)

    const flags = await db.select().from(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
    expect(flags).toHaveLength(0)
    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
  })

  it('records a failed run and rethrows when the coverage primitive throws', async () => {
    coverage.findGaps.mockRejectedValue(new Error('boom'))

    await expect(processor.onCheck({ data: { workspaceId } } as never)).rejects.toThrow('boom')

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('failed')
    expect(run.lastError).toBe('boom')
  })
})
