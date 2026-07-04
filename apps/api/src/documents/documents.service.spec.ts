import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { and, asc, eq, like } from 'drizzle-orm'
import { db, chunks, documents, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { DocumentsService } from './documents.service'
import { CacheService } from '../cache/cache.service'
import { StorageService } from '../storage/storage.service'
import { IngestService } from '../ingest/ingest.service'

async function cleanupDocumentFixtures(prefix: string) {
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
      const docs = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.workspaceId, membership.workspaceId))

      for (const document of docs) {
        await db.delete(chunks).where(eq(chunks.documentId, document.id))
      }

      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
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
  const [knowledgeBase] = await db
    .insert(knowledgeBases)
    .values({ workspaceId: workspace.id, name: `${workspaceName} KB` })
    .returning()

  return { user, workspace, knowledgeBase }
}

describe('DocumentsService', () => {
  let service: DocumentsService
  let storage: { save: jest.Mock; delete: jest.Mock; getBuffer: jest.Mock }
  let ingest: { queueDocument: jest.Mock }
  let cache: { bumpVersion: jest.Mock }
  const prefix = `documents-spec-${Date.now()}-`

  beforeAll(async () => {
    storage = {
      save: jest.fn(),
      delete: jest.fn(),
      getBuffer: jest.fn(),
    }
    ingest = {
      queueDocument: jest.fn(),
    }
    cache = {
      bumpVersion: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: StorageService, useValue: storage },
        { provide: IngestService, useValue: ingest },
        { provide: CacheService, useValue: cache },
      ],
    }).compile()

    service = moduleRef.get(DocumentsService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupDocumentFixtures(prefix)
    await pool.end()
  })

  it('upload saves object, inserts pending document with storageKey, and queues ingest', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}upload@example.com`,
      'Documents Spec WS Upload',
    )
    const file = {
      originalname: 'notes.txt',
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
    } as Express.Multer.File
    storage.save.mockImplementation(async (key: string) => key)
    ingest.queueDocument.mockResolvedValue({ queued: true })

    const result = await service.upload(workspace.id, knowledgeBase.id, file)

    const [saved] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, result.id), eq(documents.workspaceId, workspace.id)))
      .limit(1)

    expect(storage.save).toHaveBeenCalledWith(expect.stringContaining(`${workspace.id}/${knowledgeBase.id}/`), file.buffer, 'text/plain')
    expect(saved.title).toBe('notes.txt')
    expect(saved.status).toBe('pending')
    expect(saved.storageKey).toContain('notes.txt')
    expect(ingest.queueDocument).toHaveBeenCalledWith(saved.id)
  })

  it('upload rejects when the knowledge base is not in the workspace', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine@example.com`, 'Documents Spec WS Mine')
    const other = await seedWorkspaceFixture(`${prefix}other@example.com`, 'Documents Spec WS Other')

    await expect(
      service.upload(
        mine.workspace.id,
        other.knowledgeBase.id,
        {
          originalname: 'blocked.txt',
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
        } as Express.Multer.File,
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('marks the document failed when ingest enqueue fails', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}enqueue-fail@example.com`,
      'Documents Spec WS Enqueue Fail',
    )
    const file = {
      originalname: 'broken.pdf',
      buffer: Buffer.from('pdf'),
      mimetype: 'application/pdf',
    } as Express.Multer.File

    storage.save.mockResolvedValue(undefined)
    ingest.queueDocument.mockRejectedValue(new Error('Redis unavailable'))

    await expect(service.upload(workspace.id, knowledgeBase.id, file)).rejects.toThrow('Redis unavailable')

    const [saved] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspace.id), eq(documents.knowledgeBaseId, knowledgeBase.id)))
      .orderBy(asc(documents.createdAt))
      .limit(1)

    expect(saved.title).toBe('broken.pdf')
    expect(saved.status).toBe('failed')
    expect(saved.lastError).toContain('Redis unavailable')
  })

  it('listForKnowledgeBase returns the offset page shape scoped to workspace and knowledge base', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}list@example.com`, 'Documents Spec WS List')
    const other = await seedWorkspaceFixture(`${prefix}list-other@example.com`, 'Documents Spec WS List Other')

    await db.insert(documents).values({
      workspaceId: mine.workspace.id,
      knowledgeBaseId: mine.knowledgeBase.id,
      title: 'visible.txt',
      status: 'pending',
      storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/visible.txt`,
    })
    await db.insert(documents).values({
      workspaceId: other.workspace.id,
      knowledgeBaseId: other.knowledgeBase.id,
      title: 'hidden.txt',
      status: 'pending',
      storageKey: `${other.workspace.id}/${other.knowledgeBase.id}/hidden.txt`,
    })

    const list = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, {})

    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.title).toBe('visible.txt')
    expect(list.page).toBe(1)
    expect(list.pageSize).toBe(20)
    expect(list.total).toBe(1)
    expect(list.totalPages).toBe(1)
  })

  it('paginates documents newest-indexed first (updatedAt DESC) with page/pageSize', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}paginate@example.com`, 'Documents Spec WS Paginate')
    const base = new Date('2026-07-01T00:00:00.000Z')

    // updatedAt: first=+1000, second=+2000, third=+3000 -> newest-first: third, second, first
    await db.insert(documents).values([
      {
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'first.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/first.txt`,
        createdAt: new Date(base.getTime() + 1000),
        updatedAt: new Date(base.getTime() + 1000),
      },
      {
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'second.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/second.txt`,
        createdAt: new Date(base.getTime() + 2000),
        updatedAt: new Date(base.getTime() + 2000),
      },
      {
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'third.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/third.txt`,
        createdAt: new Date(base.getTime() + 3000),
        updatedAt: new Date(base.getTime() + 3000),
      },
    ])

    const firstPage = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, { page: '1', pageSize: '2' })
    expect(firstPage.items.map((item) => item.title)).toEqual(['third.txt', 'second.txt'])
    expect(firstPage.total).toBe(3)
    expect(firstPage.totalPages).toBe(2)

    const secondPage = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, { page: '2', pageSize: '2' })
    expect(secondPage.items.map((item) => item.title)).toEqual(['first.txt'])
    expect(secondPage.page).toBe(2)
  })

  it('searches documents by title and filters by status', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}filter@example.com`, 'Documents Spec WS Filter')
    await db.insert(documents).values([
      {
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'alpha-report.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/alpha-report.txt`,
      },
      {
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'beta-notes.txt',
        status: 'failed',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/beta-notes.txt`,
      },
    ])

    const searched = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, { q: 'alpha' })
    expect(searched.items.map((item) => item.title)).toEqual(['alpha-report.txt'])
    expect(searched.total).toBe(1)

    const failed = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, { status: 'failed' })
    expect(failed.items.map((item) => item.title)).toEqual(['beta-notes.txt'])
    expect(failed.total).toBe(1)
  })

  it('getDownloadable returns the stored bytes for a document in the workspace/KB', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}download@example.com`, 'Documents Spec WS Download')
    const [doc] = await db
      .insert(documents)
      .values({
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'download-me.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/download-me.txt`,
      })
      .returning()
    storage.getBuffer.mockResolvedValue(Buffer.from('file bytes'))

    const result = await service.getDownloadable(mine.workspace.id, mine.knowledgeBase.id, doc.id)

    expect(storage.getBuffer).toHaveBeenCalledWith(doc.storageKey)
    expect(result.title).toBe('download-me.txt')
    expect(result.buffer).toEqual(Buffer.from('file bytes'))
  })

  it('getDownloadable 404s for a document in another workspace', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}dl-mine@example.com`, 'Documents Spec WS DL Mine')
    const other = await seedWorkspaceFixture(`${prefix}dl-other@example.com`, 'Documents Spec WS DL Other')
    const [otherDoc] = await db
      .insert(documents)
      .values({
        workspaceId: other.workspace.id,
        knowledgeBaseId: other.knowledgeBase.id,
        title: 'secret.txt',
        status: 'done',
        storageKey: `${other.workspace.id}/${other.knowledgeBase.id}/secret.txt`,
      })
      .returning()

    await expect(
      service.getDownloadable(mine.workspace.id, mine.knowledgeBase.id, otherDoc.id),
    ).rejects.toThrow(NotFoundException)
    expect(storage.getBuffer).not.toHaveBeenCalled()
  })

  it('getManyDownloadable returns bytes for valid ids and skips missing ones', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}dl-many@example.com`, 'Documents Spec WS DL Many')
    const [a] = await db
      .insert(documents)
      .values({
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'a.txt',
        status: 'done',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/a.txt`,
      })
      .returning()
    storage.getBuffer.mockResolvedValue(Buffer.from('a-bytes'))

    const results = await service.getManyDownloadable(mine.workspace.id, mine.knowledgeBase.id, [
      a.id,
      '00000000-0000-0000-0000-000000000000',
    ])

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('a.txt')
  })

  it('remove deletes document, cascades chunks, calls storage.delete, and 404s cross-workspace ids', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}remove@example.com`, 'Documents Spec WS Remove')
    const other = await seedWorkspaceFixture(`${prefix}remove-other@example.com`, 'Documents Spec WS Remove Other')

    const [document] = await db
      .insert(documents)
      .values({
        workspaceId: mine.workspace.id,
        knowledgeBaseId: mine.knowledgeBase.id,
        title: 'delete-me.txt',
        status: 'pending',
        storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/delete-me.txt`,
      })
      .returning()

    await db.insert(chunks).values({
      documentId: document.id,
      workspaceId: mine.workspace.id,
      content: 'chunk',
      contentHash: 'chunk-hash',
      metadata: { documentId: document.id },
    })

    storage.delete.mockResolvedValue(undefined)

    await expect(service.remove(mine.workspace.id, mine.knowledgeBase.id, document.id)).resolves.toEqual({
      message: 'Document deleted',
    })
    expect(storage.delete).toHaveBeenCalledWith(document.storageKey)
    expect(cache.bumpVersion).toHaveBeenCalledWith(mine.workspace.id)

    const [deletedDoc] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1)
    const deletedChunks = await db.select().from(chunks).where(eq(chunks.documentId, document.id))
    expect(deletedDoc).toBeUndefined()
    expect(deletedChunks).toHaveLength(0)

    const [foreignDocument] = await db
      .insert(documents)
      .values({
        workspaceId: other.workspace.id,
        knowledgeBaseId: other.knowledgeBase.id,
        title: 'foreign.txt',
        status: 'pending',
        storageKey: `${other.workspace.id}/${other.knowledgeBase.id}/foreign.txt`,
      })
      .returning()

    await expect(service.remove(mine.workspace.id, mine.knowledgeBase.id, foreignDocument.id)).rejects.toThrow(
      NotFoundException,
    )
  })

  it('removeMany deletes scoped documents, skips stale or foreign ids, cascades chunks, and bumps cache once', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}remove-many@example.com`, 'Documents Spec WS Remove Many')
    const other = await seedWorkspaceFixture(`${prefix}remove-many-other@example.com`, 'Documents Spec WS Remove Many Other')

    const [first, second, foreignDocument] = await db
      .insert(documents)
      .values([
        {
          workspaceId: mine.workspace.id,
          knowledgeBaseId: mine.knowledgeBase.id,
          title: 'first.txt',
          status: 'done',
          storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/first.txt`,
        },
        {
          workspaceId: mine.workspace.id,
          knowledgeBaseId: mine.knowledgeBase.id,
          title: 'second.txt',
          status: 'done',
          storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/second.txt`,
        },
        {
          workspaceId: other.workspace.id,
          knowledgeBaseId: other.knowledgeBase.id,
          title: 'foreign.txt',
          status: 'done',
          storageKey: `${other.workspace.id}/${other.knowledgeBase.id}/foreign.txt`,
        },
      ])
      .returning()

    await db.insert(chunks).values([
      {
        documentId: first.id,
        workspaceId: mine.workspace.id,
        content: 'first chunk',
        contentHash: 'first-chunk-hash',
        metadata: { documentId: first.id },
      },
      {
        documentId: second.id,
        workspaceId: mine.workspace.id,
        content: 'second chunk',
        contentHash: 'second-chunk-hash',
        metadata: { documentId: second.id },
      },
    ])

    storage.delete.mockImplementation(async (key: string) => {
      if (key.endsWith('/second.txt')) {
        throw new Error('object already missing')
      }
    })

    const result = await service.removeMany(mine.workspace.id, mine.knowledgeBase.id, [
      first.id,
      second.id,
      foreignDocument.id,
      '00000000-0000-4000-8000-000000000000',
    ])

    expect(result).toEqual({ deleted: 2, skipped: 2 })
    expect(storage.delete).toHaveBeenCalledWith(first.storageKey)
    expect(storage.delete).toHaveBeenCalledWith(second.storageKey)
    expect(cache.bumpVersion).toHaveBeenCalledTimes(1)
    expect(cache.bumpVersion).toHaveBeenCalledWith(mine.workspace.id)

    const deletedDocs = await db.select().from(documents).where(eq(documents.workspaceId, mine.workspace.id))
    const deletedChunks = await db.select().from(chunks).where(eq(chunks.workspaceId, mine.workspace.id))
    const [foreignStillExists] = await db.select().from(documents).where(eq(documents.id, foreignDocument.id)).limit(1)
    expect(deletedDocs).toHaveLength(0)
    expect(deletedChunks).toHaveLength(0)
    expect(foreignStillExists).toBeDefined()
  })

  it('removeMany skips every id and does not bump cache when no scoped documents match', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}remove-many-empty@example.com`, 'Documents Spec WS Remove Many Empty')

    const result = await service.removeMany(mine.workspace.id, mine.knowledgeBase.id, [
      '00000000-0000-4000-8000-000000000000',
    ])

    expect(result).toEqual({ deleted: 0, skipped: 1 })
    expect(storage.delete).not.toHaveBeenCalled()
    expect(cache.bumpVersion).not.toHaveBeenCalled()
  })
})
