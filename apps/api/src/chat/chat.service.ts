import { Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, count, desc, eq, gt, ilike, lt, or, sql } from 'drizzle-orm'
import {
  buildOffsetResult,
  chatMessages,
  chatSessions,
  db,
  decodeCursor,
  encodeCursor,
  resolveOffsetPage,
  type ChatMessageSource,
} from '@repo/db'
import { CacheService } from '../cache/cache.service'
import { UsageService } from '../limits/usage.service'
import { ListQueryDto } from '../common/dto/list-query.dto'
import type { ListChatSessionsQueryDto } from './dto/list-chat-sessions-query.dto'

type CacheStatus = 'exact' | 'semantic' | 'miss'

@Injectable()
export class ChatService {
  constructor(
    private readonly cache: CacheService,
    private readonly usage: UsageService,
  ) {}

  async answer(
    workspaceId: string,
    userId: string,
    message: string,
    sessionId?: string,
  ) {
    const session = sessionId
      ? await this.getOwnedSession(workspaceId, userId, sessionId)
      : await this.createSession(workspaceId, userId, message)

    await db.insert(chatMessages).values({
      sessionId: session.id,
      role: 'user',
      content: message,
      sources: null,
    })

    const exact = await this.cache.getExact(workspaceId, message)
    if (exact) {
      return {
        sessionId: session.id,
        sources: exact.sources,
        stream: this.singleChunk(exact.answer),
        cacheStatus: 'exact' as CacheStatus,
        onComplete: async (fullText: string) =>
          this.persistAssistant(session.id, fullText, exact.sources),
      }
    }

    const { answerQuestion, countTokens, embedQuery } = await import('@repo/ai')
    const embedding = await embedQuery(message)
    const semantic = await this.cache.getSemantic(workspaceId, embedding)
    if (semantic) {
      await this.cache.setExact(workspaceId, message, semantic.answer, semantic.sources)

      return {
        sessionId: session.id,
        sources: semantic.sources,
        stream: this.singleChunk(semantic.answer),
        cacheStatus: 'semantic' as CacheStatus,
        onComplete: async (fullText: string) =>
          this.persistAssistant(session.id, fullText, semantic.sources),
      }
    }

    const version = await this.cache.getVersion(workspaceId)
    await this.usage.assertWithinBudget(workspaceId)
    // Reuse the embedding computed for the semantic-cache lookup so retrieval
    // does not embed the same message a second time on a cache miss.
    const { sources, stream, isFallback } = await answerQuestion(
      message,
      workspaceId,
      undefined,
      embedding,
    )

    return {
      sessionId: session.id,
      sources,
      stream,
      cacheStatus: 'miss' as CacheStatus,
      onComplete: async (fullText: string) => {
        await this.usage.addUsage(
          workspaceId,
          countTokens(message) + countTokens(fullText),
        )
        await this.persistAssistant(session.id, fullText, sources)
        if (!isFallback) {
          await this.cache.setExact(workspaceId, message, fullText, sources)
          await this.cache.saveSemantic(
            workspaceId,
            version,
            message,
            embedding,
            fullText,
            sources,
          )
        }
      },
    }
  }

  async listSessions(
    workspaceId: string,
    userId: string,
    query: Pick<ListChatSessionsQueryDto, 'page' | 'pageSize' | 'q'>,
  ) {
    const { page, pageSize, offset } = resolveOffsetPage(query.page, query.pageSize, { pageSize: 5 })

    const filters = [eq(chatSessions.workspaceId, workspaceId), eq(chatSessions.userId, userId)]
    const search = query.q?.trim()
    if (search) {
      filters.push(ilike(chatSessions.title, `%${search}%`))
    }
    const where = and(...filters)

    const [{ value: total }] = await db.select({ value: count() }).from(chatSessions).where(where)

    const items = await db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(where)
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
      .limit(pageSize)
      .offset(offset)

    return buildOffsetResult(items, Number(total), page, pageSize)
  }

  async getMessages(
    workspaceId: string,
    userId: string,
    sessionId: string,
    query: Pick<ListQueryDto, 'cursor' | 'limit'>,
  ) {
    const session = await this.getOwnedSession(workspaceId, userId, sessionId)
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    const createdAtUs = sql<number>`floor(extract(epoch from ${chatMessages.createdAt}) * 1000000)`

    const rows = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        sources: chatMessages.sources,
        createdAt: chatMessages.createdAt,
        cursorValue: createdAtUs,
      })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, session.id),
          cursor
            ? or(
                gt(createdAtUs, Number(cursor.k[0])),
                and(eq(createdAtUs, Number(cursor.k[0])), gt(chatMessages.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(createdAtUs), asc(chatMessages.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(({ cursorValue: _cursorValue, ...message }) => message)
    const last = items.at(-1)
    const lastRow = rows.at(Math.min(limit, rows.length) - 1)

    return {
      items,
      nextCursor:
        hasMore && last && lastRow
          ? encodeCursor({ k: [lastRow.cursorValue], id: last.id })
          : null,
    }
  }

  private async createSession(workspaceId: string, userId: string, message: string) {
    const [session] = await db
      .insert(chatSessions)
      .values({
        workspaceId,
        userId,
        title: message.slice(0, 60),
      })
      .returning()

    return session
  }

  private async getOwnedSession(workspaceId: string, userId: string, sessionId: string) {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.workspaceId, workspaceId),
          eq(chatSessions.userId, userId),
        ),
      )
      .limit(1)

    if (!session) {
      throw new NotFoundException('Chat session not found')
    }

    return session
  }

  private singleChunk(answer: string): AsyncGenerator<string> {
    return (async function* () {
      yield answer
    })()
  }

  private async persistAssistant(
    sessionId: string,
    fullText: string,
    sources: ChatMessageSource[],
  ) {
    await db.insert(chatMessages).values({
      sessionId,
      role: 'assistant',
      content: fullText,
      sources,
    })

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
  }
}
