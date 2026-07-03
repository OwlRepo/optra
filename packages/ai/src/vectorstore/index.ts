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

// Optional metadata filters, applied as indexed WHERE clauses so retrieval
// searches a narrower candidate set instead of the whole workspace.
export interface RetrievalFilters {
  sourceType?: string
  docType?: string
  productArea?: string
  sectionId?: string
}

function buildFilterSql(filters?: RetrievalFilters) {
  const conds = []
  if (filters?.sourceType) conds.push(sql`AND source_type = ${filters.sourceType}`)
  if (filters?.docType) conds.push(sql`AND doc_type = ${filters.docType}`)
  if (filters?.productArea) conds.push(sql`AND product_area = ${filters.productArea}`)
  if (filters?.sectionId) conds.push(sql`AND section_id = ${filters.sectionId}`)
  return conds.length > 0 ? sql.join(conds, sql` `) : sql``
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
        // Promote filterable metadata to indexed columns. sourceType is set by
        // the ingest pipeline ('web' for crawled docs, else 'document').
        sourceType: (chunk.metadata.sourceType as string | undefined) ?? 'document',
        docType: chunk.metadata.fileType as string | undefined,
      }))
    )
  }
}

export async function similaritySearch(
  query: string,
  workspaceId: string,
  limit = 5,
  precomputedEmbedding?: number[],
  filters?: RetrievalFilters
): Promise<SearchResult[]> {
  const queryVector = precomputedEmbedding ?? (await embedQuery(query))
  const vectorString = `[${queryVector.join(',')}]`
  const filterSql = buildFilterSql(filters)

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
    WHERE workspace_id = ${workspaceId}::uuid ${filterSql}
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
  limit = 5,
  precomputedEmbedding?: number[],
  filters?: RetrievalFilters
): Promise<SearchResult[]> {
  const queryVector = precomputedEmbedding ?? (await embedQuery(query))
  const vectorString = `[${queryVector.join(',')}]`
  const reserve = ticketSlotReserve()
  const minScore = ticketSlotMinScore()
  const filterSql = buildFilterSql(filters)

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
    WHERE workspace_id = ${workspaceId}::uuid AND document_id IS NOT NULL ${filterSql}
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
    metadata: {
      ticketId: ticket.id,
      workspaceId: ticket.workspaceId,
      source: 'ticket',
      sourceType: 'ticket',
      productArea: ticket.productArea,
      severity: ticket.severity ?? undefined,
    },
    // Filterable columns for ticket-derived chunks.
    sourceType: 'ticket',
    productArea: ticket.productArea,
  })

  return 'embedded'
}

export async function backfillTicketEmbeddings(): Promise<{
  processed: number
  embedded: number
  deleted: number
  skipped: number
  unchanged: number
  changedWorkspaceIds: string[]
}> {
  const allTickets = await db.select().from(tickets)
  const result = { processed: 0, embedded: 0, deleted: 0, skipped: 0, unchanged: 0 }
  const changedWorkspaceIds = new Set<string>()

  for (const ticket of allTickets) {
    const outcome = await syncTicketChunk(ticket)
    result.processed += 1
    result[outcome] += 1
    if (outcome === 'embedded' || outcome === 'deleted') {
      changedWorkspaceIds.add(ticket.workspaceId)
    }
  }

  return { ...result, changedWorkspaceIds: [...changedWorkspaceIds] }
}
