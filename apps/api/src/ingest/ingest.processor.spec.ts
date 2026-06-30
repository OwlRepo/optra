import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { eq, like } from 'drizzle-orm'
import { db, chunks, documents, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { IngestProcessor } from './ingest.processor'
import { StorageService } from '../storage/storage.service'

const mockLoadDocument = jest.fn()
const mockChunkDocument = jest.fn()
const mockEmbedChunks = jest.fn()
const mockSyncChunks = jest.fn()
const mockUnlink = jest.fn()

jest.mock('@repo/ai', () => ({
  loadDocument: (...args: unknown[]) => mockLoadDocument(...args),
  chunkDocument: (...args: unknown[]) => mockChunkDocument(...args),
  embedChunks: (...args: unknown[]) => mockEmbedChunks(...args),
  syncChunks: (...args: unknown[]) => mockSyncChunks(...args),
}))

jest.mock('fs/promises', () => ({
  unlink: (...args: unknown[]) => mockUnlink(...args),
}))

async function cleanupProcessorFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
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
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedDocument(emailPrefix: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${emailPrefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Ingest Spec WS ${Date.now()}`, ownerId: user.id })
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
      title: 'spec.txt',
      storageKey: `${workspace.id}/${knowledgeBase.id}/spec.txt`,
      status: 'pending',
    })
    .returning()

  return { workspace, knowledgeBase, document }
}

describe('IngestProcessor', () => {
  let processor: IngestProcessor
  let storage: { getToTempFile: jest.Mock }
  const fixtureEmailPrefix = `ingest-spec-${Date.now()}-`

  beforeAll(async () => {
    storage = { getToTempFile: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestProcessor,
        { provide: StorageService, useValue: storage },
      ],
    }).compile()

    processor = moduleRef.get(IngestProcessor)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupProcessorFixtures(fixtureEmailPrefix)
    await pool.end()
  })

  it('happy path sets processing then done, injects metadata, syncs chunks, and cleans temp file', async () => {
    const { workspace, knowledgeBase, document } = await seedDocument(fixtureEmailPrefix)
    storage.getToTempFile.mockResolvedValue('/tmp/ingest-spec.txt')
    mockUnlink.mockResolvedValue(undefined)
    mockLoadDocument.mockResolvedValue({
      content: 'hello world',
      metadata: { source: '/tmp/ingest-spec.txt', fileType: 'txt', fileName: 'ingest-spec.txt' },
    })
    mockChunkDocument.mockResolvedValue([
      {
        content: 'hello',
        contentHash: 'hash-1',
        metadata: { source: '/tmp/ingest-spec.txt', fileType: 'txt', chunkIndex: 0, totalChunks: 1, strategy: 'recursive' },
      },
    ])
    mockEmbedChunks.mockImplementation(async (input) =>
      input.map((chunk: any) => ({ ...chunk, embedding: [0.1, 0.2] })),
    )
    mockSyncChunks.mockResolvedValue(undefined)

    await expect(
      processor.handleIngest({ data: { documentId: document.id }, id: 'job-1' } as any),
    ).resolves.toBeUndefined()

    const [updated] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1)
    expect(updated.status).toBe('done')
    expect(storage.getToTempFile).toHaveBeenCalledWith(document.storageKey)
    expect(mockLoadDocument).toHaveBeenCalledWith('/tmp/ingest-spec.txt')
    expect(mockChunkDocument).toHaveBeenCalledWith({
      content: 'hello world',
      metadata: { source: '/tmp/ingest-spec.txt', fileType: 'txt', fileName: 'ingest-spec.txt' },
    })
    expect(mockEmbedChunks).toHaveBeenCalledWith([
      {
        content: 'hello',
        contentHash: 'hash-1',
        metadata: {
          source: '/tmp/ingest-spec.txt',
          fileType: 'txt',
          chunkIndex: 0,
          totalChunks: 1,
          strategy: 'recursive',
          workspaceId: workspace.id,
          knowledgeBaseId: knowledgeBase.id,
          documentId: document.id,
        },
      },
    ])
    expect(mockSyncChunks).toHaveBeenCalledWith(
      [
        {
          content: 'hello',
          contentHash: 'hash-1',
          metadata: {
            source: '/tmp/ingest-spec.txt',
            fileType: 'txt',
            chunkIndex: 0,
            totalChunks: 1,
            strategy: 'recursive',
            workspaceId: workspace.id,
            knowledgeBaseId: knowledgeBase.id,
            documentId: document.id,
          },
          embedding: [0.1, 0.2],
        },
      ],
      document.id,
      workspace.id,
    )
    expect(mockLoadDocument.mock.invocationCallOrder[0]).toBeLessThan(mockChunkDocument.mock.invocationCallOrder[0])
    expect(mockChunkDocument.mock.invocationCallOrder[0]).toBeLessThan(mockEmbedChunks.mock.invocationCallOrder[0])
    expect(mockEmbedChunks.mock.invocationCallOrder[0]).toBeLessThan(mockSyncChunks.mock.invocationCallOrder[0])
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/ingest-spec.txt')
  })

  it('failure path marks document failed and still cleans temp file', async () => {
    const { document } = await seedDocument(fixtureEmailPrefix)
    storage.getToTempFile.mockResolvedValue('/tmp/ingest-fail.txt')
    mockUnlink.mockResolvedValue(undefined)
    mockLoadDocument.mockRejectedValue(new Error('bad file'))

    await expect(
      processor.handleIngest({ data: { documentId: document.id }, id: 'job-2' } as any),
    ).resolves.toBeUndefined()

    const [updated] = await db.select().from(documents).where(eq(documents.id, document.id)).limit(1)
    expect(updated.status).toBe('failed')
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/ingest-fail.txt')
  })
})
