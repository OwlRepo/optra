import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, count, desc, eq, ilike } from 'drizzle-orm'
import { buildOffsetResult, db, documents, knowledgeBases, resolveOffsetPage } from '@repo/db'
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
    query: Pick<ListDocumentsQueryDto, 'page' | 'pageSize' | 'q' | 'status'>,
  ) {
    await this.assertKbInWorkspace(workspaceId, kbId)
    const { page, pageSize, offset } = resolveOffsetPage(query.page, query.pageSize)

    const filters = [
      eq(documents.workspaceId, workspaceId),
      eq(documents.knowledgeBaseId, kbId),
    ]
    if (query.status) {
      filters.push(eq(documents.status, query.status))
    }
    const search = query.q?.trim()
    if (search) {
      filters.push(ilike(documents.title, `%${search}%`))
    }
    const where = and(...filters)

    const [{ value: total }] = await db.select({ value: count() }).from(documents).where(where)

    const items = await db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(pageSize)
      .offset(offset)

    return buildOffsetResult(items, Number(total), page, pageSize)
  }

  /** Load a single document's stored bytes for download (member-readable). */
  async getDownloadable(workspaceId: string, kbId: string, documentId: string) {
    const doc = await this.findDownloadable(workspaceId, kbId, documentId)
    const buffer = await this.storage.getBuffer(doc.storageKey)
    return { title: doc.title, buffer }
  }

  /** Load several documents' bytes for a bulk (zip) download, skipping any without stored content. */
  async getManyDownloadable(workspaceId: string, kbId: string, documentIds: string[]) {
    const results: { title: string; buffer: Buffer }[] = []
    for (const documentId of documentIds) {
      const doc = await this.findDownloadable(workspaceId, kbId, documentId).catch(() => null)
      if (!doc) continue
      const buffer = await this.storage.getBuffer(doc.storageKey).catch((error: unknown) => {
        this.logger.warn(
          `Skipping download for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      })
      if (buffer) {
        results.push({ title: doc.title, buffer })
      }
    }

    if (results.length === 0) {
      throw new NotFoundException('No downloadable documents found')
    }

    return results
  }

  private async findDownloadable(workspaceId: string, kbId: string, documentId: string) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)

    if (!doc || doc.workspaceId !== workspaceId || doc.knowledgeBaseId !== kbId) {
      throw new NotFoundException('Document not found')
    }
    if (!doc.storageKey) {
      throw new NotFoundException('Document has no stored file')
    }

    return doc as typeof doc & { storageKey: string }
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
