import { eq } from 'drizzle-orm'
import { db, documents, faqDrafts, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { FaqDraftsService } from './faq-drafts.service'
import { StorageService } from '../storage/storage.service'
import { IngestService } from '../ingest/ingest.service'

describe('FaqDraftsService', () => {
  let storage: { save: jest.Mock }
  let ingest: { queueDocument: jest.Mock }
  let service: FaqDraftsService
  const prefix = `faq-drafts-spec-${Date.now()}-`
  let workspaceId: string
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
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    storage = { save: jest.fn().mockResolvedValue(undefined) }
    ingest = { queueDocument: jest.fn().mockResolvedValue(undefined) }
    service = new FaqDraftsService(storage as unknown as StorageService, ingest as unknown as IngestService)
    await db.delete(faqDrafts).where(eq(faqDrafts.workspaceId, workspaceId))
    await db.delete(documents).where(eq(documents.workspaceId, workspaceId))
    await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, workspaceId))
  })

  it('lists only pending drafts', async () => {
    await db
      .insert(faqDrafts)
      .values([
        { workspaceId, question: 'q1', answer: 'a1', ticketIds: ['t1'], clusterSize: 3, status: 'pending' },
        { workspaceId, question: 'q2', answer: 'a2', ticketIds: ['t2'], clusterSize: 3, status: 'approved' },
      ])

    const drafts = await service.list(workspaceId)

    expect(drafts).toHaveLength(1)
    expect(drafts[0].question).toBe('q1')
  })

  it('approves a draft, creates a document via the ingest pipeline, and marks it approved', async () => {
    const [draft] = await db
      .insert(faqDrafts)
      .values({ workspaceId, question: 'Why?', answer: 'Because.', ticketIds: ['t1'], clusterSize: 3, status: 'pending' })
      .returning()

    const result = await service.approve(workspaceId, draft.id, userId)

    expect(result.status).toBe('approved')
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(ingest.queueDocument).toHaveBeenCalledWith(result.documentId)

    const [document] = await db.select().from(documents).where(eq(documents.id, result.documentId!))
    expect(document.title).toBe('Why?')
    expect(document.status).toBe('pending')

    const [updatedDraft] = await db.select().from(faqDrafts).where(eq(faqDrafts.id, draft.id))
    expect(updatedDraft.status).toBe('approved')
    expect(updatedDraft.reviewedBy).toBe(userId)

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.workspaceId, workspaceId))
    expect(kb.name).toBe('Generated FAQs')
  })

  it('reuses the existing Generated FAQs knowledge base on a second approval', async () => {
    const [draft1] = await db
      .insert(faqDrafts)
      .values({ workspaceId, question: 'q1', answer: 'a1', ticketIds: ['t1'], clusterSize: 3, status: 'pending' })
      .returning()
    const [draft2] = await db
      .insert(faqDrafts)
      .values({ workspaceId, question: 'q2', answer: 'a2', ticketIds: ['t2'], clusterSize: 3, status: 'pending' })
      .returning()

    await service.approve(workspaceId, draft1.id, userId)
    await service.approve(workspaceId, draft2.id, userId)

    const kbs = await db.select().from(knowledgeBases).where(eq(knowledgeBases.workspaceId, workspaceId))
    expect(kbs).toHaveLength(1)
  })

  it('rejects a draft and records the reviewer', async () => {
    const [draft] = await db
      .insert(faqDrafts)
      .values({ workspaceId, question: 'q', answer: 'a', ticketIds: ['t1'], clusterSize: 3, status: 'pending' })
      .returning()

    const result = await service.reject(workspaceId, draft.id, userId)
    expect(result.status).toBe('rejected')

    const [updated] = await db.select().from(faqDrafts).where(eq(faqDrafts.id, draft.id))
    expect(updated.status).toBe('rejected')
    expect(updated.reviewedBy).toBe(userId)
  })

  it('throws when approving a draft that is not pending', async () => {
    const [draft] = await db
      .insert(faqDrafts)
      .values({ workspaceId, question: 'q', answer: 'a', ticketIds: ['t1'], clusterSize: 3, status: 'rejected' })
      .returning()

    await expect(service.approve(workspaceId, draft.id, userId)).rejects.toThrow(
      'FAQ draft not found or already reviewed',
    )
  })
})
