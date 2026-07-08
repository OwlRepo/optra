import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { vector } from './chunks'
import { workspaces } from './workspaces'

export const datasetStatusEnum = pgEnum('dataset_status', ['pending', 'processing', 'done', 'failed'])

export interface DatasetColumn {
  name: string
  type: 'number' | 'string' | 'date' | 'boolean'
}

// Workspace-scoped structured-data files (CSV/XLSX) queried via ephemeral
// DuckDB at question time — NOT chunked/embedded like `documents`. Only the
// generated description is embedded, for semantic dataset selection.
export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  storageKey: text('storage_key'),
  description: text('description'),
  descriptionEmbedding: vector('description_embedding'),
  columnsSchema: jsonb('columns_schema').$type<DatasetColumn[]>(),
  rowCount: integer('row_count'),
  contentHash: varchar('content_hash', { length: 64 }),
  status: datasetStatusEnum('status').notNull().default('pending'),
  queueJobId: text('queue_job_id'),
  enqueuedAt: timestamp('enqueued_at'),
  processingStartedAt: timestamp('processing_started_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Dataset = typeof datasets.$inferSelect
export type NewDataset = typeof datasets.$inferInsert
