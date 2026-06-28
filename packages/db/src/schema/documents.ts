import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { knowledgeBases } from './knowledgeBases'

export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'processing',
  'done',
  'failed',
])

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id).notNull(),
  knowledgeBaseId: uuid('knowledge_base_id').references(() => knowledgeBases.id).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  sourceUrl: text('source_url'),
  contentHash: varchar('content_hash', { length: 64 }),
  status: documentStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
