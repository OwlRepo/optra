import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import { db, decodeCursor, documents, encodeCursor, knowledgeBases } from '@repo/db'
import { IngestService } from '../ingest/ingest.service'
import { StorageService } from '../storage/storage.service'
import { CacheService } from '../cache/cache.service'
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto'

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly ingest: IngestService,
    private readonly cache: CacheService,
  ) {}

  async upload(workspaceId: string, kbId: string, file: Express.Multer.File) {
    await this.assertKbInWorkspace(workspaceId, kbId)

    const storageKey = `${workspaceId}/${kbId}/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)

    const [document] = await db
      .insert(documents)
      .values({
        workspaceId,
        knowledgeBaseId: kbId,
        title: file.originalname,
        storageKey,
        status: 'pending',
      })
      .returning()

    try {
      await this.ingest.queueDocument(document.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(documents)
        .set({
          status: 'failed',
          lastError: `Queue enqueue failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id))
      this.logger.error(`Document upload enqueue failed documentId=${document.id}: ${message}`)
      throw error
    }

    return {
      id: document.id,
      title: document.title,
      status: document.status,
    }
  }

  async listForKnowledgeBase(
    workspaceId: string,
    kbId: string,
    query: Pick<ListDocumentsQueryDto, 'cursor' | 'limit'>,
  ) {
    await this.assertKbInWorkspace(workspaceId, kbId)
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const createdAtMs = sql<number>`floor(extract(epoch from ${documents.createdAt}) * 1000)`

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          eq(documents.knowledgeBaseId, kbId),
          cursor
            ? or(
                gt(createdAtMs, Number(cursor.k[0])),
                and(
                  eq(createdAtMs, Number(cursor.k[0])),
                  gt(documents.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(createdAtMs), asc(documents.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)
    const last = items.at(-1)

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ k: [last.createdAt.getTime()], id: last.id })
          : null,
    }
  }

  async remove(workspaceId: string, kbId: string, documentId: string): Promise<{ message: string }> {
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)

    if (!document || document.workspaceId !== workspaceId || document.knowledgeBaseId !== kbId) {
      throw new NotFoundException('Document not found')
    }

    if (document.storageKey) {
      await this.storage.delete(document.storageKey).catch((error: unknown) => {
        this.logger.warn(
          `Failed to delete storage object ${document.storageKey}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }

    await db.delete(documents).where(eq(documents.id, documentId))
    await this.cache.bumpVersion(workspaceId)

    return { message: 'Document deleted' }
  }

  private async assertKbInWorkspace(workspaceId: string, kbId: string) {
    const [knowledgeBase] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1)

    if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
      throw new NotFoundException('Knowledge base not found')
    }

    return knowledgeBase
  }
}
