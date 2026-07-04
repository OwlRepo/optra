import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { users } from './users'

export const savedRefinedMessages = pgTable('saved_refined_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  originalText: text('original_text').notNull(),
  refinedText: text('refined_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type SavedRefinedMessage = typeof savedRefinedMessages.$inferSelect
export type NewSavedRefinedMessage = typeof savedRefinedMessages.$inferInsert
