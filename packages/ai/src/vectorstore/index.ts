import { createHash } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, chunks as chunksTable, tickets, type Ticket } from '@repo/db'
import type { EmbeddedChunk } from '../embeddings/types'
import { embedQuery } from '../embeddings'

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export async function syncChunks(
  embeddedChunks: EmbeddedChunk[],
  documentId: string,
  workspaceId: string
): Promise<void> {
  const incoming = embeddedChunks.map(c => ({
    chunk: c,
    hash: c.contentHash,
  }))

  const existing = await db
    .select({ id: chunksTable.id, contentHash: chunksTable.contentHash })
    .from(chunksTable)
    .where(eq(chunksTable.documentId, documentId))

  const existingHashSet = new Set(existing.map(r => r.contentHash))
  const incomingHashSet = new Set(incoming.map(r => r.hash))

  const toDelete = existing
    .filter(r => !incomingHashSet.has(r.contentHash))
    .map(r => r.id)

  if (toDelete.length > 0) {
    await db.delete(chunksTable).where(inArray(chunksTable.id, toDelete))
  }

  const toInsert = incoming.filter(r => !existingHashSet.has(r.hash))

  if (toInsert.length > 0) {
    await db.insert(chunksTable).values(
      toInsert.map(({ chunk }) => ({
        documentId,
        workspaceId,
        content: chunk.content,
        contentHash: chunk.contentHash,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
        sectionId: chunk.metadata.sectionId as string | undefined,
        sectionTitle: chunk.metadata.sectionTitle as string | undefined,
      }))
    )
  }
}

export async function similaritySearch(
  query: string,
  workspaceId: string,
  limit = 5
): Promise<SearchResult[]> {
  const queryVector = await embedQuery(query)
  const vectorString = `[${queryVector.join(',')}]`

  const rows = await db.execute<{
    id: string
    content: string
    metadata: Record<string, unknown>
    score: number
  }>(sql`
    SELECT
      id,
      content,
      metadata,
      1 - (embedding <=> ${vectorString}::vector) AS score
    FROM chunks
    WHERE workspace_id = ${workspaceId}::uuid
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${limit}
  `)

  return rows.rows.map(row => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata ?? {},
    score: row.score,
  }))
}

function ticketSlotReserve(): number {
  return Number.parseInt(process.env.TICKET_SLOT_RESERVE ?? '1', 10)
}

function ticketSlotMinScore(): number {
  return Number.parseFloat(process.env.TICKET_SLOT_MIN_SCORE ?? '0.3')
}

export async function similaritySearchWithTicketSlot(
  query: string,
  workspaceId: string,
  limit = 5
): Promise<SearchResult[]> {
  const queryVector = await embedQuery(query)
  const vectorString = `[${queryVector.join(',')}]`
  const reserve = ticketSlotReserve()
  const minScore = ticketSlotMinScore()

  const documentRows = await db.execute<{
    id: string
    content: string
    metadata: Record<string, unknown>
    score: number
  }>(sql`
    SELECT
      id,
      content,
      metadata,
      1 - (embedding <=> ${vectorString}::vector) AS score
    FROM chunks
    WHERE workspace_id = ${workspaceId}::uuid AND document_id IS NOT NULL
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${limit}
  `)

  const ticketRows = await db.execute<{
    id: string
    content: string
    metadata: Record<string, unknown>
    score: number
  }>(sql`
    SELECT
      id,
      content,
      metadata,
      1 - (embedding <=> ${vectorString}::vector) AS score
    FROM chunks
    WHERE workspace_id = ${workspaceId}::uuid AND ticket_id IS NOT NULL
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${reserve}
  `)

  const documentResults: SearchResult[] = documentRows.rows.map(row => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata ?? {},
    score: row.score,
  }))

  const qualifyingTicketResults: SearchResult[] = ticketRows.rows
    .filter(row => row.score >= minScore)
    .map(row => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata ?? {},
      score: row.score,
    }))

  if (qualifyingTicketResults.length === 0) {
    return documentResults.slice(0, limit)
  }

  const documentBudget = Math.max(limit - qualifyingTicketResults.length, 0)
  const merged = [...documentResults.slice(0, documentBudget), ...qualifyingTicketResults]

  return merged.sort((a, b) => b.score - a.score)
}

function buildTicketChunkContent(ticket: Ticket): string {
  return [
    `Title: ${ticket.title ?? 'N/A'}`,
    `Issue Summary: ${ticket.issueSummary ?? 'N/A'}`,
    `Repro Steps: ${ticket.reproSteps ?? 'N/A'}`,
    `Root Cause: ${ticket.hypothesizedRootCause ?? 'N/A'}`,
    `Next Action: ${ticket.nextAction ?? 'N/A'}`,
    `Severity: ${ticket.severity ?? 'N/A'}`,
    `Product Area: ${ticket.productArea}`,
  ].join('\n')
}

export async function syncTicketChunk(
  ticket: Ticket,
): Promise<'embedded' | 'deleted' | 'unchanged' | 'skipped'> {
  const qualifies =
    ticket.status === 'done' && ticket.reviewedBy !== null && ticket.usefulness === 'useful'

  const [existing] = await db
    .select({ id: chunksTable.id, contentHash: chunksTable.contentHash })
    .from(chunksTable)
    .where(eq(chunksTable.ticketId, ticket.id))
    .limit(1)

  if (!qualifies) {
    if (!existing) return 'skipped'
    await db.delete(chunksTable).where(eq(chunksTable.ticketId, ticket.id))
    return 'deleted'
  }

  const content = buildTicketChunkContent(ticket)
  const contentHash = createHash('sha256').update(content).digest('hex')

  if (existing && existing.contentHash === contentHash) {
    return 'unchanged'
  }

  const embedding = await embedQuery(content)

  await db.delete(chunksTable).where(eq(chunksTable.ticketId, ticket.id))
  await db.insert(chunksTable).values({
    ticketId: ticket.id,
    documentId: null,
    workspaceId: ticket.workspaceId,
    content,
    contentHash,
    embedding,
    metadata: { ticketId: ticket.id, workspaceId: ticket.workspaceId, source: 'ticket' },
  })

  return 'embedded'
}

export async function backfillTicketEmbeddings(): Promise<{
  processed: number
  embedded: number
  deleted: number
  skipped: number
  unchanged: number
}> {
  const allTickets = await db.select().from(tickets)
  const result = { processed: 0, embedded: 0, deleted: 0, skipped: 0, unchanged: 0 }

  for (const ticket of allTickets) {
    const outcome = await syncTicketChunk(ticket)
    result.processed += 1
    result[outcome] += 1
  }

  return result
}
