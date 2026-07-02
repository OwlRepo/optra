import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const workspaceEventTypeEnum = pgEnum('workspace_event_type', [
  'document_ingested',
  'document_failed',
  'scrape_completed',
  'scrape_failed',
  'ticket_extracted',
  'ticket_failed',
])

export const workspaceEvents = pgTable('workspace_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  type: workspaceEventTypeEnum('type').notNull(),
  entityId: uuid('entity_id').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  detail: text('detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type WorkspaceEvent = typeof workspaceEvents.$inferSelect
export type NewWorkspaceEvent = typeof workspaceEvents.$inferInsert
