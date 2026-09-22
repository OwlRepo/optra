import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const workspaceEventTypeEnum = pgEnum('workspace_event_type', [
  'document_ingested',
  'document_failed',
  'scrape_completed',
  'scrape_failed',
  'ticket_extracted',
  'ticket_failed',
  // S8. Raised only by automatic comparisons. `comparison_flagged`, not
  // `comparison_completed`: it fires only when a run actually found something,
  // because `unreadCount` has no per-type filter and `markSeen` is one global
  // watermark, so a clean run nobody asked for would climb the Overview badge
  // with nothing to act on. A name that promised every completion and delivered
  // only the noisy ones would be a lie a later reader has to discover.
  'comparison_flagged',
  'comparison_failed',
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
