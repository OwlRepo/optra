import { Injectable } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { refineMessage } from '@repo/ai'
import { db, savedRefinedMessages } from '@repo/db'
import { UsageService } from '../limits/usage.service'

const SAVED_MESSAGES_LIMIT = 20

@Injectable()
export class RefineService {
  constructor(private readonly usage: UsageService) {}

  // Ledger only: refine never had the Redis token budget (its own per-user daily
  // count is the guard), so off mode keeps behaving as before while the cost is
  // still priced and recorded; on mode applies the plan's dollar cap.
  async refine(workspaceId: string, rawText: string): Promise<{ original: string; refined: string }> {
    const refined = await this.usage.metered(workspaceId, (meter) => refineMessage(rawText, { meter }), {
      ledgerOnly: true,
    })
    return { original: rawText, refined }
  }

  async saveRefinedMessage(
    workspaceId: string,
    userId: string,
    input: { originalText: string; refinedText: string },
  ) {
    const [saved] = await db
      .insert(savedRefinedMessages)
      .values({
        workspaceId,
        userId,
        originalText: input.originalText,
        refinedText: input.refinedText,
      })
      .returning()

    return saved
  }

  async listSavedRefinedMessages(workspaceId: string, userId: string) {
    return db
      .select()
      .from(savedRefinedMessages)
      .where(
        and(
          eq(savedRefinedMessages.workspaceId, workspaceId),
          eq(savedRefinedMessages.userId, userId),
        ),
      )
      .orderBy(desc(savedRefinedMessages.createdAt), desc(savedRefinedMessages.id))
      .limit(SAVED_MESSAGES_LIMIT)
  }
}
