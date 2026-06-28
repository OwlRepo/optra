import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type KnowledgeBase = typeof knowledgeBases.$inferSelect
export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert
