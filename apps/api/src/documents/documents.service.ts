import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, asc, eq } from 'drizzle-orm'
import { db, documents, knowledgeBases } from '@repo/db'
import { IngestService } from '../ingest/ingest.service'
import { StorageService } from '../storage/storage.service'

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly ingest: IngestService,
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

    await this.ingest.queueDocument(document.id)

    return {
      id: document.id,
      title: document.title,
      status: document.status,
    }
  }

  async listForKnowledgeBase(workspaceId: string, kbId: string) {
    await this.assertKbInWorkspace(workspaceId, kbId)

    return db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.knowledgeBaseId, kbId)))
      .orderBy(asc(documents.createdAt))
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
