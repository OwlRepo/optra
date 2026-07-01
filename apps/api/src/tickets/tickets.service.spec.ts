import { InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
import { createHash } from 'crypto'
import {
  db,
  pool,
  tickets,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { TicketsService } from './tickets.service'

async function cleanupTicketFixtures(prefix: string) {
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
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))
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
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

  return { user, workspace }
}

describe('TicketsService', () => {
  let service: TicketsService
  let queue: { add: jest.Mock; getJob: jest.Mock; on: jest.Mock }
  const prefix = `tickets-service-spec-${Date.now()}-`

  beforeAll(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'ticket:job-1' }),
      getJob: jest.fn().mockResolvedValue({ id: 'ticket:job-1' }),
      on: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getQueueToken('ticket-extraction-queue'), useValue: queue },
      ],
    }).compile()

    service = moduleRef.get(TicketsService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupTicketFixtures(prefix)
    await pool.end()
  })

  it('create inserts pending ticket and enqueues extraction on dedup miss', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}create@example.com`,
      'Tickets Spec Create',
    )

    const result = await service.create(workspace.id, 'Customer says export hangs forever')

    expect(result.statusCode).toBe(202)
    expect(result.ticket.status).toBe('pending')
    expect(queue.add).toHaveBeenCalledWith(
      { ticketId: result.ticket.id },
      expect.objectContaining({
        jobId: `ticket-extraction:${result.ticket.id}`,
        attempts: 1,
        timeout: 5 * 60_000,
      }),
    )
  })

  it('create returns existing ticket on dedup hit without enqueue', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}dedup@example.com`,
      'Tickets Spec Dedup',
    )
    const first = await service.create(workspace.id, 'Same transcript repeated')
    queue.add.mockClear()

    const second = await service.create(workspace.id, 'Same transcript repeated')

    expect(second.statusCode).toBe(200)
    expect(second.ticket.id).toBe(first.ticket.id)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('create falls through to new ticket when stale dedup lookup returns deleted row id', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}deleted@example.com`,
      'Tickets Spec Deleted',
    )
    const original = await service.create(workspace.id, 'Racey transcript')
    await db.delete(tickets).where(eq(tickets.id, original.ticket.id))

    const created = await service.create(workspace.id, 'Racey transcript')

    expect(created.statusCode).toBe(202)
    expect(created.ticket.id).not.toBe(original.ticket.id)
    expect(queue.add).toHaveBeenCalled()
  })

  it('marks ticket failed when enqueue fails after insert', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}enqueue@example.com`,
      'Tickets Spec Enqueue',
    )
    queue.add.mockRejectedValueOnce(new Error('Redis unavailable'))

    await expect(service.create(workspace.id, 'Broken queue')).rejects.toThrow('Redis unavailable')

    const saved = await db
      .select()
      .from(tickets)
      .where(eq(tickets.workspaceId, workspace.id))

    expect(saved).toHaveLength(1)
    expect(saved[0]?.status).toBe('failed')
    expect(saved[0]?.lastError).toContain('Redis unavailable')
  })

  it('patch saves edits and feedback, sets reviewedBy and reviewedAt', async () => {
    const { workspace, user } = await seedWorkspaceFixture(
      `${prefix}patch@example.com`,
      'Tickets Spec Patch',
    )
    const created = await service.create(workspace.id, 'Patch transcript')

    const updated = await service.update(workspace.id, created.ticket.id, user.id, {
      title: 'Patched title',
      severity: 'medium',
      usefulness: 'useful',
      editState: 'accepted',
      feedbackNote: 'Looks good',
    })

    expect(updated.title).toBe('Patched title')
    expect(updated.severity).toBe('medium')
    expect(updated.usefulness).toBe('useful')
    expect(updated.reviewedBy).toBe(user.id)
    expect(updated.reviewedAt).toBeInstanceOf(Date)
    expect(updated.fieldConfidence.title).toBeGreaterThan(0)
  })

  it('wraps insert failures in typed Nest exception', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}dberror@example.com`,
      'Tickets Spec DB Error',
    )
    const insertSpy = jest.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('db exploded')
    })

    await expect(service.create(workspace.id, 'DB fail transcript')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )

    insertSpy.mockRestore()
  })

  it('404s when listing or updating foreign workspace ticket id', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine@example.com`, 'Mine')
    const other = await seedWorkspaceFixture(`${prefix}other@example.com`, 'Other')
    const created = await service.create(other.workspace.id, 'Other workspace transcript')

    await expect(service.getOne(mine.workspace.id, created.ticket.id)).rejects.toThrow(NotFoundException)
    await expect(
      service.update(mine.workspace.id, created.ticket.id, mine.user.id, { title: 'blocked' }),
    ).rejects.toThrow(NotFoundException)
  })

  it('returns existing ticket when insert loses dedup race on unique violation', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}race@example.com`,
      'Tickets Spec Race',
    )
    const transcript = 'Same transcript racing between requests'
    const transcriptHash = createHash('sha256').update(transcript).digest('hex')
    const [existing] = await db
      .insert(tickets)
      .values({
        workspaceId: workspace.id,
        transcript,
        transcriptHash,
        status: 'done',
        title: 'Existing draft',
        productArea: 'general',
        fieldConfidence: {},
      })
      .returning()

    const findExistingSpy = jest
      .spyOn(service as any, 'findExistingTicketByHash')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing)
    const insertSpy = jest.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      })
    })

    const result = await service.create(workspace.id, transcript)

    expect(result.statusCode).toBe(200)
    expect(result.ticket.id).toBe(existing.id)
    expect(queue.add).not.toHaveBeenCalled()

    const rows = await db.select().from(tickets).where(eq(tickets.workspaceId, workspace.id))
    expect(rows).toHaveLength(1)

    insertSpy.mockRestore()
    findExistingSpy.mockRestore()
  })

  it('keeps pending ticket alive within extended missing-job grace and fails older stale rows', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}reconcile@example.com`,
      'Tickets Spec Reconcile',
    )
    const now = new Date('2026-07-01T12:00:00.000Z')

    const [freshPending] = await db
      .insert(tickets)
      .values({
        workspaceId: workspace.id,
        transcript: 'Fresh pending transcript',
        transcriptHash: `fresh-${Date.now()}`,
        status: 'pending',
        queueJobId: 'ticket-extraction:fresh',
        enqueuedAt: new Date(now.getTime() - 3 * 60_000),
        productArea: 'general',
        fieldConfidence: {},
      })
      .returning()

    const [stalePending] = await db
      .insert(tickets)
      .values({
        workspaceId: workspace.id,
        transcript: 'Stale pending transcript',
        transcriptHash: `stale-${Date.now()}`,
        status: 'pending',
        queueJobId: 'ticket-extraction:stale',
        enqueuedAt: new Date(now.getTime() - 11 * 60_000),
        productArea: 'general',
        fieldConfidence: {},
      })
      .returning()

    queue.getJob.mockResolvedValue(null)

    await service.reconcileTickets(now)

    const [freshRow] = await db.select().from(tickets).where(eq(tickets.id, freshPending.id)).limit(1)
    const [staleRow] = await db.select().from(tickets).where(eq(tickets.id, stalePending.id)).limit(1)

    expect(freshRow.status).toBe('pending')
    expect(staleRow.status).toBe('failed')
    expect(staleRow.lastError).toContain('missing Bull job')
  })

  it('getOne omits internal queue plumbing and keeps transcript plus confidence', async () => {
    const { workspace } = await seedWorkspaceFixture(
      `${prefix}projection@example.com`,
      'Tickets Spec Projection',
    )
    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId: workspace.id,
        transcript: 'Projection transcript',
        transcriptHash: `projection-${Date.now()}`,
        status: 'done',
        queueJobId: 'ticket-extraction:projection',
        enqueuedAt: new Date(),
        processingStartedAt: new Date(),
        productArea: 'general',
        fieldConfidence: {
          title: 0.8,
        },
      })
      .returning()

    const detail = await service.getOne(workspace.id, ticket.id)

    expect(detail.transcript).toBe('Projection transcript')
    expect(detail.fieldConfidence).toEqual({ title: 0.8 })
    expect(detail).not.toHaveProperty('queueJobId')
    expect(detail).not.toHaveProperty('transcriptHash')
    expect(detail).not.toHaveProperty('enqueuedAt')
    expect(detail).not.toHaveProperty('processingStartedAt')
  })
})
