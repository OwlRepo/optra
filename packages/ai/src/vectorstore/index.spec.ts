import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, like, sql } from 'drizzle-orm'
import {
  chunks,
  db,
  documents,
  knowledgeBases,
  pool,
  tickets,
  users,
  workspaceMembers,
  workspaces,
  type Ticket,
} from '@repo/db'

const embedQueryMock = vi.fn()

vi.mock('../embeddings', () => ({
  embedQuery: embedQueryMock,
}))

async function cleanupFixtures(prefix: string) {
  const matchedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`))

  for (const user of matchedUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(chunks).where(eq(chunks.workspaceId, membership.workspaceId))
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))
      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(workspaceMembers).where(
    sql`${workspaceMembers.userId} in (${db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${prefix}%`))})`,
  )
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspace(prefix: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${prefix}-${crypto.randomUUID()}@example.com`,
      passwordHash: 'x',
      isVerified: true,
    })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `${prefix} workspace`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })
  const [kb] = await db
    .insert(knowledgeBases)
    .values({ workspaceId: workspace.id, name: `${prefix} kb` })
    .returning()

  return { user, workspace, kb }
}

async function seedTicket(workspaceId: string, reviewedBy: string, overrides: Partial<Ticket> = {}) {
  const [ticket] = await db
    .insert(tickets)
    .values({
      workspaceId,
      transcript: overrides.transcript ?? `Transcript ${crypto.randomUUID()}`,
      transcriptHash: overrides.transcriptHash ?? crypto.randomUUID().replace(/-/g, ''),
      title: overrides.title ?? 'Ticket title',
      issueSummary: overrides.issueSummary ?? 'Issue summary',
      reproSteps: overrides.reproSteps ?? 'Repro steps',
      severity: overrides.severity ?? 'medium',
      productArea: overrides.productArea ?? 'auth',
      hypothesizedRootCause: overrides.hypothesizedRootCause ?? 'Root cause',
      nextAction: overrides.nextAction ?? 'Next action',
      status: overrides.status ?? 'done',
      fieldConfidence: overrides.fieldConfidence ?? {},
      usefulness: overrides.usefulness ?? 'useful',
      reviewedBy: overrides.reviewedBy === undefined ? reviewedBy : overrides.reviewedBy,
      reviewedAt: overrides.reviewedAt ?? new Date(),
    })
    .returning()

  return ticket
}

describe('ticket vector sync', () => {
  const prefix = `vectorstore-ticket-spec-${Date.now()}`

  beforeEach(() => {
    vi.clearAllMocks()
    embedQueryMock.mockResolvedValue(new Array(1536).fill(0.01))
  })

  afterEach(async () => {
    await cleanupFixtures(prefix)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('qualifying ticket with no existing chunk embeds one ticket chunk', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id)
    const { syncTicketChunk } = await import('./index')

    const outcome = await syncTicketChunk(ticket)

    expect(outcome).toBe('embedded')
    expect(embedQueryMock).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(chunks).where(eq(chunks.ticketId, ticket.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.documentId).toBeNull()
    expect(rows[0]?.workspaceId).toBe(workspace.id)
    expect(rows[0]?.metadata).toMatchObject({
      ticketId: ticket.id,
      workspaceId: workspace.id,
      source: 'ticket',
    })
  })

  it('qualifying ticket with unchanged content skips embedding', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id)
    const { syncTicketChunk } = await import('./index')

    await syncTicketChunk(ticket)
    embedQueryMock.mockClear()

    const outcome = await syncTicketChunk(ticket)

    expect(outcome).toBe('unchanged')
    expect(embedQueryMock).not.toHaveBeenCalled()
  })

  it('qualifying ticket with changed content replaces previous chunk', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id)
    const { syncTicketChunk } = await import('./index')

    await syncTicketChunk(ticket)
    embedQueryMock.mockClear()

    const [updatedTicket] = await db
      .update(tickets)
      .set({ title: 'Updated ticket title', updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id))
      .returning()

    const outcome = await syncTicketChunk(updatedTicket)

    expect(outcome).toBe('embedded')
    expect(embedQueryMock).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(chunks).where(eq(chunks.ticketId, ticket.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.content).toContain('Updated ticket title')
  })

  it('non-qualifying ticket with existing chunk deletes it', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id)
    const { syncTicketChunk } = await import('./index')

    await syncTicketChunk(ticket)
    const [notUseful] = await db
      .update(tickets)
      .set({ usefulness: 'not_useful', updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id))
      .returning()

    embedQueryMock.mockClear()
    const outcome = await syncTicketChunk(notUseful)

    expect(outcome).toBe('deleted')
    expect(embedQueryMock).not.toHaveBeenCalled()
    const rows = await db.select().from(chunks).where(eq(chunks.ticketId, ticket.id))
    expect(rows).toHaveLength(0)
  })

  it('non-qualifying ticket with no existing chunk skips', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id, {
      usefulness: 'not_useful',
    })
    const { syncTicketChunk } = await import('./index')

    const outcome = await syncTicketChunk(ticket)

    expect(outcome).toBe('skipped')
    expect(embedQueryMock).not.toHaveBeenCalled()
  })

  it('check constraint rejects both-parent and no-parent chunk rows', async () => {
    const { workspace, user, kb } = await seedWorkspace(prefix)
    const ticket = await seedTicket(workspace.id, user.id)
    const [document] = await db
      .insert(documents)
      .values({
        workspaceId: workspace.id,
        knowledgeBaseId: kb.id,
        title: 'Doc',
        storageKey: `doc-${crypto.randomUUID()}.txt`,
        status: 'done',
      })
      .returning()

    await expect(
      db.insert(chunks).values({
        workspaceId: workspace.id,
        documentId: document.id,
        ticketId: ticket.id,
        content: 'invalid both',
        contentHash: crypto.randomUUID().replace(/-/g, ''),
      }),
    ).rejects.toThrow()

    await expect(
      db.insert(chunks).values({
        workspaceId: workspace.id,
        documentId: null,
        ticketId: null,
        content: 'invalid none',
        contentHash: crypto.randomUUID().replace(/-/g, ''),
      }),
    ).rejects.toThrow()
  })

  it('backfill processes all tickets and tallies outcomes', async () => {
    const { workspace, user } = await seedWorkspace(prefix)
    await seedTicket(workspace.id, user.id)
    await seedTicket(workspace.id, user.id, { usefulness: 'not_useful' })

    const { backfillTicketEmbeddings } = await import('./index')
    const result = await backfillTicketEmbeddings()

    expect(result.processed).toBeGreaterThanOrEqual(2)
    expect(result.embedded).toBeGreaterThanOrEqual(1)
    expect(result.skipped + result.deleted + result.unchanged + result.embedded).toBe(result.processed)
  })
})
