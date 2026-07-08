import { Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { documents, documentReviewFlags, db } from '@repo/db'

@Injectable()
export class InsightsService {
  async listFreshnessFlags(workspaceId: string) {
    return db
      .select({
        id: documentReviewFlags.id,
        documentId: documentReviewFlags.documentId,
        documentTitle: documents.title,
        ticketId: documentReviewFlags.ticketId,
        score: documentReviewFlags.score,
        reason: documentReviewFlags.reason,
        status: documentReviewFlags.status,
        createdAt: documentReviewFlags.createdAt,
      })
      .from(documentReviewFlags)
      .innerJoin(documents, eq(documentReviewFlags.documentId, documents.id))
      .where(and(eq(documentReviewFlags.workspaceId, workspaceId), eq(documentReviewFlags.status, 'open')))
      .orderBy(desc(documentReviewFlags.createdAt))
  }

  async dismissFlag(workspaceId: string, flagId: string, userId: string) {
    const [updated] = await db
      .update(documentReviewFlags)
      .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: userId })
      .where(and(eq(documentReviewFlags.id, flagId), eq(documentReviewFlags.workspaceId, workspaceId)))
      .returning({ id: documentReviewFlags.id })

    if (!updated) {
      throw new NotFoundException('Freshness flag not found')
    }

    return { id: updated.id, dismissed: true }
  }
}
