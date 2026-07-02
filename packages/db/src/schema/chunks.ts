import {
  check,
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  customType,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { documents } from './documents'
import { tickets } from './tickets'
import { workspaces } from './workspaces'

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)'
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value)
  },
})

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id).notNull(),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  embedding: vector('embedding'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  sectionId: varchar('section_id', { length: 255 }),
  sectionTitle: text('section_title'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  ticketIdUniqueIdx: uniqueIndex('chunks_ticket_id_unique_idx').on(table.ticketId),
  exactlyOneParentCheck: check(
    'chunks_exactly_one_parent_check',
    sql`(${table.documentId} IS NOT NULL) <> (${table.ticketId} IS NOT NULL)`,
  ),
}))

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
