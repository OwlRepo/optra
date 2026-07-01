import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { eq, like } from 'drizzle-orm'
import { db, pool, tickets, users, workspaceMembers, workspaces } from '@repo/db'
import { TicketExtractionProcessor } from './ticket-extraction.processor'

const mockExtractTicketFromTranscript = jest.fn()

jest.mock('@repo/ai', () => ({
  extractTicketFromTranscript: (...args: unknown[]) => mockExtractTicketFromTranscript(...args),
}))

async function cleanupTicketFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedTicket(emailPrefix: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${emailPrefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Ticket Spec WS ${Date.now()}`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [ticket] = await db
    .insert(tickets)
    .values({
      workspaceId: workspace.id,
      transcript: 'Customer transcript',
      transcriptHash: `hash-${randomUUID()}`,
      status: 'pending',
    })
    .returning()

  return { workspace, user, ticket }
}

describe('TicketExtractionProcessor', () => {
  let processor: TicketExtractionProcessor
  const prefix = `ticket-processor-spec-${Date.now()}-`

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TicketExtractionProcessor],
    }).compile()

    processor = moduleRef.get(TicketExtractionProcessor)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupTicketFixtures(prefix)
    await pool.end()
  })

  it('moves ticket from processing to done with extracted fields', async () => {
    const { ticket } = await seedTicket(prefix)
    mockExtractTicketFromTranscript.mockResolvedValue({
      title: 'OTP login loop',
      issueSummary: 'User gets kicked back to login after OTP verify.',
      reproSteps: '1. Verify OTP\n2. Observe redirect',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'Cookie missing',
      nextAction: 'Inspect verify response cookies',
      fieldConfidence: {
        title: 0.9,
        issueSummary: 0.9,
        reproSteps: 0.8,
        severity: 0.8,
        productArea: 0.8,
        hypothesizedRootCause: 0.7,
        nextAction: 0.8,
      },
    })

    await processor.handleExtraction({ data: { ticketId: ticket.id }, id: 'job-1' } as any)

    const [updated] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1)
    expect(updated.status).toBe('done')
    expect(updated.title).toBe('OTP login loop')
    expect(updated.fieldConfidence.title).toBe(0.9)
  })

  it('marks ticket failed when extraction throws typed error', async () => {
    const { ticket } = await seedTicket(prefix)
    mockExtractTicketFromTranscript.mockRejectedValue(new Error('Model refusal'))

    await processor.handleExtraction({ data: { ticketId: ticket.id }, id: 'job-2' } as any)

    const [updated] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1)
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('Model refusal')
  })

  it('does not overwrite reviewed fields when rerun hits a done ticket', async () => {
    const { ticket } = await seedTicket(prefix)
    await db
      .update(tickets)
      .set({
        status: 'done',
        title: 'Human-edited title',
        issueSummary: 'Human summary',
        hypothesizedRootCause: 'Reviewed cause',
        fieldConfidence: {
          title: 0.99,
          issueSummary: 0.95,
          hypothesizedRootCause: 0.95,
        },
      })
      .where(eq(tickets.id, ticket.id))

    mockExtractTicketFromTranscript.mockResolvedValue({
      title: 'LLM replacement title',
      issueSummary: 'LLM summary',
      reproSteps: '1. Do thing',
      severity: 'high',
      productArea: 'auth',
      hypothesizedRootCause: 'LLM guess',
      nextAction: 'LLM action',
      fieldConfidence: {
        title: 0.4,
        issueSummary: 0.4,
        reproSteps: 0.4,
        severity: 0.4,
        productArea: 0.4,
        hypothesizedRootCause: 0.4,
        nextAction: 0.4,
      },
    })

    await processor.handleExtraction({ data: { ticketId: ticket.id }, id: 'job-3' } as any)

    const [updated] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1)
    expect(updated.status).toBe('done')
    expect(updated.title).toBe('Human-edited title')
    expect(updated.issueSummary).toBe('Human summary')
    expect(updated.hypothesizedRootCause).toBe('Reviewed cause')
  })
})
