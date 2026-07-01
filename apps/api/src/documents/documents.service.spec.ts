import { BadRequestException, NotFoundException } from '@nestjs/common'
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
  let storage: { save: jest.Mock; delete: jest.Mock }
  let ingest: { queueDocument: jest.Mock }
  let cache: { bumpVersion: jest.Mock }
  const prefix = `documents-spec-${Date.now()}-`

  beforeAll(async () => {
    storage = {
      save: jest.fn(),
      delete: jest.fn(),
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

  it('listForKnowledgeBase is scoped to workspace and knowledge base', async () => {
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
    expect(list.nextCursor).toBeNull()
  })

  it('paginates documents by createdAt cursor and survives concurrent inserts', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}paginate@example.com`, 'Documents Spec WS Paginate')
    const base = new Date('2026-07-01T00:00:00.000Z')

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

    const firstPage = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, { limit: 2 })

    expect(firstPage.items.map((item) => item.title)).toEqual(['first.txt', 'second.txt'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    await db.insert(documents).values({
      workspaceId: mine.workspace.id,
      knowledgeBaseId: mine.knowledgeBase.id,
      title: 'between-pages.txt',
      status: 'done',
      storageKey: `${mine.workspace.id}/${mine.knowledgeBase.id}/between-pages.txt`,
      createdAt: new Date(base.getTime() + 2500),
      updatedAt: new Date(base.getTime() + 2500),
    })

    const secondPage = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    const combinedTitles = [...firstPage.items, ...secondPage.items].map((item) => item.title)

    expect(combinedTitles.filter((title) => title === 'first.txt')).toHaveLength(1)
    expect(combinedTitles.filter((title) => title === 'second.txt')).toHaveLength(1)
    expect(combinedTitles.filter((title) => title === 'third.txt')).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
  })

  it('rejects invalid document cursor', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}bad-cursor@example.com`, 'Documents Spec WS Bad Cursor')

    await expect(
      service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id, {
        cursor: '%%%bad%%%',
      }),
    ).rejects.toThrow(BadRequestException)
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
})
