import { randomUUID } from 'crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { db, documents, faqDrafts, knowledgeBases } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { IngestService } from '../ingest/ingest.service'

const FAQ_KNOWLEDGE_BASE_NAME = 'Generated FAQs'

@Injectable()
export class FaqDraftsService {
  constructor(
    private readonly storage: StorageService,
    private readonly ingest: IngestService,
  ) {}

  async list(workspaceId: string) {
    return db
      .select()
      .from(faqDrafts)
      .where(and(eq(faqDrafts.workspaceId, workspaceId), eq(faqDrafts.status, 'pending')))
      .orderBy(desc(faqDrafts.createdAt))
  }

  async reject(workspaceId: string, draftId: string, userId: string) {
    const [updated] = await db
      .update(faqDrafts)
      .set({ status: 'rejected', reviewedBy: userId, reviewedAt: new Date() })
      .where(and(eq(faqDrafts.id, draftId), eq(faqDrafts.workspaceId, workspaceId), eq(faqDrafts.status, 'pending')))
      .returning({ id: faqDrafts.id })

    if (!updated) {
      throw new NotFoundException('FAQ draft not found or already reviewed')
    }

    return { id: updated.id, status: 'rejected' as const }
  }

  // Approval materializes the draft as a normal documents row through the
  // EXISTING ingest pipeline — same pattern scrape.processor.ts uses for
  // crawled pages (write .txt to storage, insert documents row, enqueue
  // ingest). Zero retrieval-side changes: chunking/embedding/caching are
  // completely unaware this document originated from an FAQ draft.
  async approve(workspaceId: string, draftId: string, userId: string) {
    const [draft] = await db
      .select()
      .from(faqDrafts)
      .where(and(eq(faqDrafts.id, draftId), eq(faqDrafts.workspaceId, workspaceId), eq(faqDrafts.status, 'pending')))

    if (!draft) {
      throw new NotFoundException('FAQ draft not found or already reviewed')
    }

    const knowledgeBaseId = await this.getOrCreateFaqKnowledgeBase(workspaceId)
    const storageKey = `${workspaceId}/${knowledgeBaseId}/faq/${randomUUID()}.txt`
    const content = `Q: ${draft.question}\n\nA: ${draft.answer}`
    await this.storage.save(storageKey, Buffer.from(content, 'utf-8'), 'text/plain')

    const [document] = await db
      .insert(documents)
      .values({
        workspaceId,
        knowledgeBaseId,
        title: draft.question,
        storageKey,
        status: 'pending',
      })
      .returning()

    await this.ingest.queueDocument(document.id)

    await db
      .update(faqDrafts)
      .set({ status: 'approved', documentId: document.id, reviewedBy: userId, reviewedAt: new Date() })
      .where(eq(faqDrafts.id, draftId))

    return { id: draft.id, status: 'approved' as const, documentId: document.id }
  }

  private async getOrCreateFaqKnowledgeBase(workspaceId: string): Promise<string> {
    const [existing] = await db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.workspaceId, workspaceId), eq(knowledgeBases.name, FAQ_KNOWLEDGE_BASE_NAME)))

    if (existing) return existing.id

    const [created] = await db
      .insert(knowledgeBases)
      .values({ workspaceId, name: FAQ_KNOWLEDGE_BASE_NAME })
      .returning({ id: knowledgeBases.id })

    return created.id
  }
}
