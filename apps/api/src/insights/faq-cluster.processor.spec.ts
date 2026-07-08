import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db, faqDrafts, pool, tickets, users, workspaceMembers, workspaces } from '@repo/db'
import { FaqClusterProcessor } from './faq-cluster.processor'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'
import { FaqClusterService } from './faq-cluster.service'
import { BackgroundRunsService } from './background-runs.service'

const { generateFaqDraft } = jest.requireMock('@repo/ai') as { generateFaqDraft: jest.Mock }

jest.mock('@repo/ai', () => ({
  generateFaqDraft: jest.fn(),
}))

describe('FaqClusterProcessor', () => {
  let coverage: { findUncoveredTickets: jest.Mock }
  let clusterer: { cluster: jest.Mock }
  let runs: BackgroundRunsService
  let processor: FaqClusterProcessor
  const prefix = `faq-cluster-processor-spec-${Date.now()}-`
  let workspaceId: string
  let ticketIds: string[]

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id

    const rows = await db
      .insert(tickets)
      .values([
        { workspaceId, transcript: 't1', transcriptHash: randomUUID(), status: 'done', title: 'Cannot log in' },
        { workspaceId, transcript: 't2', transcriptHash: randomUUID(), status: 'done', title: 'Login broken' },
        { workspaceId, transcript: 't3', transcriptHash: randomUUID(), status: 'done', title: 'Sign-in fails' },
      ])
      .returning({ id: tickets.id })
    ticketIds = rows.map((row) => row.id)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    coverage = { findUncoveredTickets: jest.fn() }
    clusterer = { cluster: jest.fn() }
    runs = new BackgroundRunsService()
    processor = new FaqClusterProcessor(
      coverage as unknown as TicketDocCoverageService,
      clusterer as unknown as FaqClusterService,
      runs,
    )
    await db.delete(faqDrafts).where(eq(faqDrafts.workspaceId, workspaceId))
  })

  it('creates one draft per surviving cluster', async () => {
    coverage.findUncoveredTickets.mockResolvedValue(
      ticketIds.map((id) => ({ ticketId: id, embedding: [1, 0, 0], score: 0.2 })),
    )
    clusterer.cluster.mockReturnValue([ticketIds])
    generateFaqDraft.mockResolvedValue({ question: 'Why can\'t I log in?', answer: 'Check your credentials.' })

    await processor.onCluster({ data: { workspaceId } } as never)

    const drafts = await db.select().from(faqDrafts).where(eq(faqDrafts.workspaceId, workspaceId))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      question: "Why can't I log in?",
      answer: 'Check your credentials.',
      clusterSize: 3,
      status: 'pending',
    })
    expect(drafts[0].ticketIds.sort()).toEqual([...ticketIds].sort())
  })

  it('excludes tickets already covered by a pending draft from future clustering input', async () => {
    await db.insert(faqDrafts).values({
      workspaceId,
      question: 'q',
      answer: 'a',
      ticketIds: [ticketIds[0]],
      clusterSize: 3,
      status: 'pending',
    })
    coverage.findUncoveredTickets.mockResolvedValue(
      ticketIds.map((id) => ({ ticketId: id, embedding: [1, 0, 0], score: 0.2 })),
    )
    clusterer.cluster.mockReturnValue([])

    await processor.onCluster({ data: { workspaceId } } as never)

    const [eligible] = clusterer.cluster.mock.calls[0]
    expect(eligible.map((t: { ticketId: string }) => t.ticketId)).toEqual([ticketIds[1], ticketIds[2]])
  })

  it('records a failed run and rethrows when the coverage primitive throws', async () => {
    coverage.findUncoveredTickets.mockRejectedValue(new Error('boom'))

    await expect(processor.onCluster({ data: { workspaceId } } as never)).rejects.toThrow('boom')
  })
})
