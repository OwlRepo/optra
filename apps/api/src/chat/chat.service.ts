import { Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, count, desc, eq, gt, ilike, lt, ne, or, sql } from 'drizzle-orm'
import {
  buildOffsetResult,
  chatMessages,
  chatQueryMetrics,
  chatSessions,
  db,
  decodeCursor,
  encodeCursor,
  resolveOffsetPage,
  type ChatMessageSource,
} from '@repo/db'
import type { HistoryTurn } from '@repo/ai'
import { CacheService } from '../cache/cache.service'
import { UsageService } from '../limits/usage.service'
import { ListQueryDto } from '../common/dto/list-query.dto'
import type { ListChatSessionsQueryDto } from './dto/list-chat-sessions-query.dto'
import { StructuredQueryService } from '../structured-query/structured-query.service'

type CacheStatus = 'exact' | 'semantic' | 'miss' | 'structured'

@Injectable()
export class ChatService {
  constructor(
    private readonly cache: CacheService,
    private readonly usage: UsageService,
    private readonly structuredQuery: StructuredQueryService,
  ) {}

  async answer(
    workspaceId: string,
    userId: string,
    message: string,
    sessionId?: string,
  ) {
    const startedAt = Date.now()
    const session = sessionId
      ? await this.getOwnedSession(workspaceId, userId, sessionId)
      : await this.createSession(workspaceId, userId, message)

    const [inserted] = await db
      .insert(chatMessages)
      .values({
        sessionId: session.id,
        role: 'user',
        content: message,
        sources: null,
      })
      .returning({ id: chatMessages.id })

    const {
      answerQuestion,
      classifyQuery,
      classifyStructuredIntent,
      condenseQuestion,
      countTokens,
      embedQuery,
      boundHistory,
      historyCondenseEnabled,
      historyInAnswerEnabled,
      historyMaxMessages,
    } = await import('@repo/ai')

    // History only needs fetching when at least one history-aware behavior is
    // on; when both are off this whole block is skipped, keeping that config
    // byte-identical to pre-history behavior (no extra DB round-trip either).
    const needsHistory = historyCondenseEnabled() || historyInAnswerEnabled()
    const history = needsHistory
      ? boundHistory(await this.getRecentHistory(session.id, inserted.id, historyMaxMessages()))
      : []

    // Condensing must run before any cache/embed lookup: caching a follow-up
    // like "find more like that" by its literal text would collide across
    // unrelated conversations. Skipped entirely (zero LLM cost) when there's
    // no history to resolve pronouns/references against.
    const standaloneQuestion =
      history.length > 0 ? await condenseQuestion(message, history) : message

    // Structured (dataset/DuckDB) intent is decided before either cache
    // lookup: computed answers over mutable datasets must never be served
    // from a stale RAG cache entry, the same way fallback answers are never
    // cached. Cheap-first: a workspace with zero ready datasets never pays
    // for the (still LLM-free) keyword check's result mattering.
    if (
      classifyStructuredIntent(standaloneQuestion) &&
      (await this.structuredQuery.hasReadyDatasets(workspaceId))
    ) {
      return this.answerStructured(workspaceId, session.id, standaloneQuestion, startedAt)
    }

    const exact = await this.cache.getExact(workspaceId, standaloneQuestion)
    if (exact) {
      return {
        sessionId: session.id,
        sources: exact.sources,
        stream: this.singleChunk(exact.answer),
        cacheStatus: 'exact' as CacheStatus,
        structuredState: undefined,
        structuredCandidates: undefined,
        onComplete: async (fullText: string) => {
          const chatMessageId = await this.persistAssistant(session.id, fullText, exact.sources)
          await this.recordQueryMetrics({
            workspaceId,
            sessionId: session.id,
            chatMessageId,
            question: standaloneQuestion,
            questionEmbedding: null,
            sources: exact.sources,
            isFallback: false,
            cacheStatus: 'exact',
            queryClass: classifyQuery(standaloneQuestion),
            startedAt,
          }).catch((error) => console.error('Failed to record chat query metrics', error))
        },
      }
    }

    const embedding = await embedQuery(standaloneQuestion)
    const semantic = await this.cache.getSemantic(workspaceId, embedding)
    if (semantic) {
      await this.cache.setExact(workspaceId, standaloneQuestion, semantic.answer, semantic.sources)

      return {
        sessionId: session.id,
        sources: semantic.sources,
        stream: this.singleChunk(semantic.answer),
        cacheStatus: 'semantic' as CacheStatus,
        structuredState: undefined,
        structuredCandidates: undefined,
        onComplete: async (fullText: string) => {
          const chatMessageId = await this.persistAssistant(session.id, fullText, semantic.sources)
          await this.recordQueryMetrics({
            workspaceId,
            sessionId: session.id,
            chatMessageId,
            question: standaloneQuestion,
            questionEmbedding: embedding,
            sources: semantic.sources,
            isFallback: false,
            cacheStatus: 'semantic',
            queryClass: classifyQuery(standaloneQuestion),
            startedAt,
          }).catch((error) => console.error('Failed to record chat query metrics', error))
        },
      }
    }

    const version = await this.cache.getVersion(workspaceId)
    await this.usage.assertWithinBudget(workspaceId)
    // Reuse the embedding computed for the semantic-cache lookup so retrieval
    // does not embed the same message a second time on a cache miss.
    const { sources, stream, isFallback } = await answerQuestion(
      standaloneQuestion,
      workspaceId,
      undefined,
      embedding,
      undefined,
      history,
    )

    return {
      sessionId: session.id,
      sources,
      stream,
      cacheStatus: 'miss' as CacheStatus,
      structuredState: undefined,
      structuredCandidates: undefined,
      onComplete: async (fullText: string) => {
        const condensedTokens =
          standaloneQuestion !== message ? countTokens(standaloneQuestion) : 0
        await this.usage.addUsage(
          workspaceId,
          countTokens(message) + countTokens(fullText) + condensedTokens,
        )
        const chatMessageId = await this.persistAssistant(session.id, fullText, sources)
        await this.recordQueryMetrics({
          workspaceId,
          sessionId: session.id,
          chatMessageId,
          question: standaloneQuestion,
          questionEmbedding: embedding,
          sources,
          isFallback,
          cacheStatus: 'miss',
          queryClass: classifyQuery(standaloneQuestion),
          startedAt,
        }).catch((error) => console.error('Failed to record chat query metrics', error))
        if (!isFallback) {
          await this.cache.setExact(workspaceId, standaloneQuestion, fullText, sources)
          await this.cache.saveSemantic(
            workspaceId,
            version,
            standaloneQuestion,
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

  private async getRecentHistory(
    sessionId: string,
    excludeMessageId: string,
    limit: number,
  ): Promise<HistoryTurn[]> {
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, sessionId), ne(chatMessages.id, excludeMessageId)))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit)

    return rows.reverse()
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

  private async answerStructured(
    workspaceId: string,
    sessionId: string,
    standaloneQuestion: string,
    startedAt: number,
  ) {
    const result = await this.structuredQuery.answer(workspaceId, standaloneQuestion)
    // Only a confident answer becomes a persisted citation — ambiguous/
    // correction/empty are momentary UX, not something worth citing forever.
    const sources: ChatMessageSource[] =
      result.state === 'confident' && result.datasetId && result.datasetName
        ? [
            {
              sourceType: 'dataset',
              datasetId: result.datasetId,
              title: result.datasetName,
              score: 1,
              snippet: 'Answered using this dataset via structured query.',
            },
          ]
        : []

    return {
      sessionId,
      sources,
      stream: this.singleChunk(result.answer),
      cacheStatus: 'structured' as CacheStatus,
      structuredState: result.state,
      structuredCandidates: result.candidates,
      onComplete: async (fullText: string) => {
        const chatMessageId = await this.persistAssistant(sessionId, fullText, sources)
        await this.recordQueryMetrics({
          workspaceId,
          sessionId,
          chatMessageId,
          question: standaloneQuestion,
          questionEmbedding: null,
          sources,
          isFallback: result.state !== 'confident',
          cacheStatus: 'structured',
          queryClass: 'structured',
          startedAt,
        }).catch((error) => console.error('Failed to record chat query metrics', error))
      },
    }
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
  ): Promise<string> {
    const [inserted] = await db
      .insert(chatMessages)
      .values({
        sessionId,
        role: 'assistant',
        content: fullText,
        sources,
      })
      .returning({ id: chatMessages.id })

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))

    return inserted.id
  }

  private async recordQueryMetrics(params: {
    workspaceId: string
    sessionId: string
    chatMessageId: string
    question: string
    questionEmbedding: number[] | null
    sources: ChatMessageSource[]
    isFallback: boolean
    cacheStatus: CacheStatus
    queryClass: string
    startedAt: number
  }) {
    const topScore =
      params.sources.length > 0 ? Math.max(...params.sources.map((source) => source.score)) : null

    await db.insert(chatQueryMetrics).values({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      chatMessageId: params.chatMessageId,
      question: params.question,
      questionEmbedding: params.questionEmbedding,
      topScore,
      sourceCount: params.sources.length,
      isFallback: params.isFallback,
      cacheStatus: params.cacheStatus,
      queryClass: params.queryClass,
      latencyMs: Date.now() - params.startedAt,
    })
  }
}
