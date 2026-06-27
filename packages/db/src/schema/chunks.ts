import { pgTable, uuid, text, jsonb, timestamp, customType } from 'drizzle-orm/pg-core'
import { documents } from './documents'
import { tenants } from './tenants'

// pgvector custom type
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)'
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value)
  },
})

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id).notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding'),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
