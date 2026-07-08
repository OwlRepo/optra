import { boolean, index, integer, pgTable, real, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { chatMessages, chatSessions } from './chatSessions'
import { vector } from './chunks'
import { workspaces } from './workspaces'

// Write-only retrieval-quality telemetry, recorded once per chat turn on the
// hot ChatService.answer() path (fire-and-forget — see recordQueryMetrics).
// Read side (fallback-rate trends, topic-gap clustering) lands with F6/F7a.
export const chatQueryMetrics = pgTable(
  'chat_query_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => chatSessions.id, { onDelete: 'cascade' })
      .notNull(),
    chatMessageId: uuid('chat_message_id')
      .references(() => chatMessages.id, { onDelete: 'cascade' })
      .notNull(),
    question: text('question').notNull(),
    // Null on exact-cache hits: those never re-embed the question, and
    // exact hits are the least interesting rows for topic-gap analysis anyway.
    questionEmbedding: vector('question_embedding'),
    topScore: real('top_score'),
    sourceCount: integer('source_count').notNull().default(0),
    isFallback: boolean('is_fallback').notNull().default(false),
    cacheStatus: varchar('cache_status', { length: 16 }).notNull(),
    queryClass: varchar('query_class', { length: 32 }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index('chat_query_metrics_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
)

export type ChatQueryMetric = typeof chatQueryMetrics.$inferSelect
export type NewChatQueryMetric = typeof chatQueryMetrics.$inferInsert
