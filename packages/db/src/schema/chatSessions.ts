import { index, pgEnum, pgTable, text, timestamp, uuid, varchar, jsonb } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { users } from './users'

export type ChatMessageSource =
  | {
      sourceType: 'document'
      documentId: string
      knowledgeBaseId?: string
      title: string
      sourceUrl: string | null
      score: number
      snippet: string
    }
  | { sourceType: 'ticket'; ticketId: string; title: string; score: number; snippet: string }

export const chatMessageRoleEnum = pgEnum('chat_message_role', ['user', 'assistant'])

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => chatSessions.id, { onDelete: 'cascade' })
      .notNull(),
    role: chatMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    sources: jsonb('sources').$type<ChatMessageSource[] | null>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index('chat_messages_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
)

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert
export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert
