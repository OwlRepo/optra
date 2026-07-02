import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, gt, lt, or, sql } from 'drizzle-orm'
import {
  db,
  decodeCursor,
  encodeCursor,
  workspaceEvents,
  workspaceEventTypeEnum,
  workspaceMembers,
} from '@repo/db'
import { ListQueryDto } from '../common/dto/list-query.dto'

type WorkspaceEventType = (typeof workspaceEventTypeEnum.enumValues)[number]

@Injectable()
export class EventsService {
  async record(
    workspaceId: string,
    type: WorkspaceEventType,
    entityId: string,
    title: string,
    detail?: string,
  ) {
    await db.insert(workspaceEvents).values({
      workspaceId,
      type,
      entityId,
      title,
      detail: detail ?? null,
    })
  }

  async list(workspaceId: string, query: Pick<ListQueryDto, 'cursor' | 'limit'>) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const createdAtMs = sql<number>`floor(extract(epoch from ${workspaceEvents.createdAt}) * 1000)`

    const rows = await db
      .select()
      .from(workspaceEvents)
      .where(
        and(
          eq(workspaceEvents.workspaceId, workspaceId),
          cursor
            ? or(
                lt(createdAtMs, Number(cursor.k[0])),
                and(eq(createdAtMs, Number(cursor.k[0])), lt(workspaceEvents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(createdAtMs), desc(workspaceEvents.id))
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

  async unreadCount(workspaceId: string, userId: string): Promise<number> {
    const [membership] = await db
      .select({ eventsSeenAt: workspaceMembers.eventsSeenAt })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1)

    const [row] = await db
      .select({ count: count() })
      .from(workspaceEvents)
      .where(
        and(
          eq(workspaceEvents.workspaceId, workspaceId),
          membership?.eventsSeenAt
            ? gt(workspaceEvents.createdAt, membership.eventsSeenAt)
            : undefined,
        ),
      )

    return row?.count ?? 0
  }

  async markSeen(workspaceId: string, userId: string) {
    await db
      .update(workspaceMembers)
      .set({ eventsSeenAt: new Date() })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
  }
}
