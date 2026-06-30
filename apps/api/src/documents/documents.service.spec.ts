import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
import { db, chunks, documents, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { DocumentsService } from './documents.service'
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
  const prefix = `documents-spec-${Date.now()}-`

  beforeAll(async () => {
    storage = {
      save: jest.fn(),
      delete: jest.fn(),
    }
    ingest = {
      queueDocument: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: StorageService, useValue: storage },
        { provide: IngestService, useValue: ingest },
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

    const list = await service.listForKnowledgeBase(mine.workspace.id, mine.knowledgeBase.id)

    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('visible.txt')
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
