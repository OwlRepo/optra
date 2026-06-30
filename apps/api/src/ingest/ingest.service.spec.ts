import { randomUUID } from 'crypto'
import { getQueueToken } from '@nestjs/bull'
import { Test } from '@nestjs/testing'
import { eq, like } from 'drizzle-orm'
import {
  db,
  documents,
  knowledgeBases,
  pool,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { IngestService } from './ingest.service'

async function cleanupFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedDocument(prefix: string, status: 'pending' | 'processing' = 'pending') {
  const [user] = await db
    .insert(users)
    .values({ email: `${prefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Ingest Queue WS ${Date.now()}`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [knowledgeBase] = await db
    .insert(knowledgeBases)
    .values({ workspaceId: workspace.id, name: `KB ${Date.now()}` })
    .returning()
  const [document] = await db
    .insert(documents)
    .values({
      workspaceId: workspace.id,
      knowledgeBaseId: knowledgeBase.id,
      title: `${status}.txt`,
      storageKey: `${workspace.id}/${knowledgeBase.id}/${status}.txt`,
      status,
    })
    .returning()

  return { workspace, knowledgeBase, document }
}

describe('IngestService', () => {
  let service: IngestService
  let queue: { add: jest.Mock; getJob: jest.Mock; on: jest.Mock }
  const prefix = `ingest-service-spec-${Date.now()}-`

  beforeAll(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'ingest:job-1' }),
      getJob: jest.fn().mockResolvedValue({ id: 'ingest:job-1' }),
      on: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestService,
        { provide: getQueueToken('ingest-queue'), useValue: queue },
      ],
    }).compile()

    service = moduleRef.get(IngestService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('queues documents with a deterministic Bull job id', async () => {
    const { document } = await seedDocument(prefix)

    await service.queueDocument(document.id)

    expect(queue.add).toHaveBeenCalledWith(
      { documentId: document.id },
      expect.objectContaining({
        jobId: `ingest:${document.id}`,
        attempts: 3,
        timeout: 5 * 60_000,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    )
  })

  it('requeue clears stale processingStartedAt before putting the document back to pending', async () => {
    const { document } = await seedDocument(prefix, 'processing')
    await db
      .update(documents)
      .set({
        processingStartedAt: new Date(Date.now() - 60_000),
      })
      .where(eq(documents.id, document.id))

    await service.queueDocument(document.id)

    const [updated] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1)
    expect(updated.status).toBe('pending')
    expect(updated.processingStartedAt).toBeNull()
  })

  it('reconciliation marks stale pending and processing documents failed when the Bull job is missing', async () => {
    const stalePending = await seedDocument(prefix, 'pending')
    const staleProcessing = await seedDocument(prefix, 'processing')

    await db
      .update(documents)
      .set({
        queueJobId: `ingest:${stalePending.document.id}`,
        enqueuedAt: new Date(Date.now() - 3 * 60_000),
      })
      .where(eq(documents.id, stalePending.document.id))

    await db
      .update(documents)
      .set({
        queueJobId: `ingest:${staleProcessing.document.id}`,
        enqueuedAt: new Date(Date.now() - 31 * 60_000),
        processingStartedAt: new Date(Date.now() - 31 * 60_000),
      })
      .where(eq(documents.id, staleProcessing.document.id))

    queue.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await service.reconcileDocuments()

    const [pendingDoc] = await db.select().from(documents).where(eq(documents.id, stalePending.document.id)).limit(1)
    const [processingDoc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, staleProcessing.document.id))
      .limit(1)

    expect(pendingDoc.status).toBe('failed')
    expect(pendingDoc.lastError).toContain('missing Bull job')
    expect(processingDoc.status).toBe('failed')
    expect(processingDoc.lastError).toContain('missing Bull job')
  })

  it('reconciliation leaves fresh documents and rows with live Bull jobs untouched', async () => {
    const freshPending = await seedDocument(prefix, 'pending')
    const liveProcessing = await seedDocument(prefix, 'processing')

    await db
      .update(documents)
      .set({
        queueJobId: `ingest:${freshPending.document.id}`,
        enqueuedAt: new Date(),
      })
      .where(eq(documents.id, freshPending.document.id))

    await db
      .update(documents)
      .set({
        queueJobId: `ingest:${liveProcessing.document.id}`,
        enqueuedAt: new Date(Date.now() - 31 * 60_000),
        processingStartedAt: new Date(Date.now() - 31 * 60_000),
      })
      .where(eq(documents.id, liveProcessing.document.id))

    queue.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === `ingest:${liveProcessing.document.id}`) {
        return { id: jobId }
      }
      return null
    })

    await service.reconcileDocuments()

    const [freshDoc] = await db.select().from(documents).where(eq(documents.id, freshPending.document.id)).limit(1)
    const [liveDoc] = await db.select().from(documents).where(eq(documents.id, liveProcessing.document.id)).limit(1)

    expect(freshDoc.status).toBe('pending')
    expect(liveDoc.status).toBe('processing')
  })
})
