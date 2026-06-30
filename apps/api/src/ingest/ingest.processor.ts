import { unlink } from 'fs/promises'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { db, documents } from '@repo/db'
import { eq } from 'drizzle-orm'
import { StorageService } from '../storage/storage.service'
import { CacheService } from '../cache/cache.service'

@Processor('ingest-queue')
export class IngestProcessor {
  private readonly logger = new Logger(IngestProcessor.name)

  constructor(
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  @Process()
  async handleIngest(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data
    const processingStartedAt = new Date()

    this.logger.log(`Ingest processor start documentId=${documentId} jobId=${String(job.id)}`)

    await db
      .update(documents)
      .set({
        status: 'processing',
        processingStartedAt,
        lastError: null,
        updatedAt: processingStartedAt,
      })
      .where(eq(documents.id, documentId))

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)

    if (!document) {
      throw new Error(`Document not found: ${documentId}`)
    }

    if (!document.storageKey) {
      await db
        .update(documents)
        .set({
          status: 'failed',
          lastError: 'Document is missing storageKey',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId))
      return
    }

    let tempPath: string | undefined

    try {
      const { loadDocument, chunkDocument, embedChunks, syncChunks } = await import('@repo/ai')
      tempPath = await this.storage.getToTempFile(document.storageKey)
      const loaded = await loadDocument(tempPath)
      const chunked = await chunkDocument(loaded)

      for (const chunk of chunked) {
        chunk.metadata.workspaceId = document.workspaceId
        chunk.metadata.knowledgeBaseId = document.knowledgeBaseId
        chunk.metadata.documentId = documentId
      }

      const embedded = await embedChunks(chunked)
      await syncChunks(embedded, documentId, document.workspaceId)

      await db
        .update(documents)
        .set({ status: 'done', lastError: null, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
      this.logger.log(`Ingest processor completed documentId=${documentId} jobId=${String(job.id)}`)
      await this.cache.bumpVersion(document.workspaceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Ingest failed for document ${documentId}`,
        error instanceof Error ? error.stack : message,
      )
      await db
        .update(documents)
        .set({ status: 'failed', lastError: message, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }
}
