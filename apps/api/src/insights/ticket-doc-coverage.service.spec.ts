import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { chunks, db, documents, documentReviewFlags, knowledgeBases, pool, tickets, users, workspaceMembers, workspaces } from '@repo/db'
import { TicketDocCoverageService } from './ticket-doc-coverage.service'

function embeddingNear(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.01)
}

describe('TicketDocCoverageService', () => {
  let service: TicketDocCoverageService
  const prefix = `coverage-spec-${Date.now()}-`
  let workspaceId: string
  let documentId: string

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
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    service = new TicketDocCoverageService()
    await db.delete(chunks).where(eq(chunks.workspaceId, workspaceId))
    await db.delete(documentReviewFlags).where(eq(documentReviewFlags.workspaceId, workspaceId))
    await db.delete(tickets).where(eq(tickets.workspaceId, workspaceId))
  })

  async function seedTicketChunk(overrides: { embeddingSeed: number; createdAt?: Date }) {
    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId,
        transcript: 't',
        transcriptHash: randomUUID(),
        status: 'done',
      })
      .returning()

    await db.insert(chunks).values({
      workspaceId,
      ticketId: ticket.id,
      content: 'ticket content',
      contentHash: randomUUID(),
      embedding: embeddingNear(overrides.embeddingSeed),
      sourceType: 'ticket',
      createdAt: overrides.createdAt ?? new Date(),
    })

    return ticket.id
  }

  async function seedDocumentChunk(embeddingSeed: number) {
    await db.insert(chunks).values({
      workspaceId,
      documentId,
      content: 'doc content',
      contentHash: randomUUID(),
      embedding: embeddingNear(embeddingSeed),
      sourceType: 'document',
    })
  }

  it('flags a gap when the nearest document chunk scores below the threshold', async () => {
    const ticketId = await seedTicketChunk({ embeddingSeed: 1 })
    await seedDocumentChunk(500) // far away seed -> low cosine similarity

    const gaps = await service.findGaps(workspaceId)

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ documentId, ticketId })
  })

  it('does not flag when the nearest document chunk is a close match', async () => {
    const ticketId = await seedTicketChunk({ embeddingSeed: 1 })
    await seedDocumentChunk(1) // same seed -> cosine ~1

    const gaps = await service.findGaps(workspaceId)

    expect(gaps.find((gap) => gap.ticketId === ticketId)).toBeUndefined()
  })

  it('excludes ticket chunks outside the lookback window', async () => {
    const staleDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    await seedTicketChunk({ embeddingSeed: 1, createdAt: staleDate })
    await seedDocumentChunk(500)

    const gaps = await service.findGaps(workspaceId)

    expect(gaps).toHaveLength(0)
  })

  it('does not re-flag a pair that already has an open flag', async () => {
    const ticketId = await seedTicketChunk({ embeddingSeed: 1 })
    await seedDocumentChunk(500)

    await db.insert(documentReviewFlags).values({
      workspaceId,
      documentId,
      ticketId,
      reason: 'ticket-mismatch',
      status: 'open',
    })

    const gaps = await service.findGaps(workspaceId)

    expect(gaps).toHaveLength(0)
  })
})
