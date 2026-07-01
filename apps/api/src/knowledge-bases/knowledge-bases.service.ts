import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm'
import { db, decodeCursor, documents, encodeCursor, knowledgeBases } from '@repo/db'
import { ListQueryDto } from '../common/dto/list-query.dto'

@Injectable()
export class KnowledgeBasesService {
  async create(workspaceId: string, name: string) {
    const [knowledgeBase] = await db
      .insert(knowledgeBases)
      .values({ workspaceId, name })
      .returning()

    return knowledgeBase
  }

  async listForWorkspace(
    workspaceId: string,
    query: Pick<ListQueryDto, 'cursor' | 'limit'>,
  ) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const createdAtMs = sql<number>`floor(extract(epoch from ${knowledgeBases.createdAt}) * 1000)`

    const rows = await db
      .select()
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.workspaceId, workspaceId),
          cursor
            ? or(
                lt(createdAtMs, Number(cursor.k[0])),
                and(eq(createdAtMs, Number(cursor.k[0])), lt(knowledgeBases.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(createdAtMs), desc(knowledgeBases.id))
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

  async remove(workspaceId: string, kbId: string): Promise<{ message: string }> {
    const [knowledgeBase] = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, kbId))
      .limit(1)

    if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
      throw new NotFoundException('Knowledge base not found')
    }

    const [docCount] = await db
      .select({ count: count() })
      .from(documents)
      .where(eq(documents.knowledgeBaseId, kbId))

    if (docCount.count > 0) {
      throw new ConflictException('Knowledge base is not empty')
    }

    await db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.workspaceId, workspaceId)))

    return { message: 'Knowledge base deleted' }
  }
}
