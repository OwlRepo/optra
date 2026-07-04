import { Injectable } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { refineMessage } from '@repo/ai'
import { db, savedRefinedMessages } from '@repo/db'

const SAVED_MESSAGES_LIMIT = 20

@Injectable()
export class RefineService {
  async refine(rawText: string): Promise<{ original: string; refined: string }> {
    const refined = await refineMessage(rawText)
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
