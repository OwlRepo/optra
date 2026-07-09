import { index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const procurementDocStatusEnum = pgEnum('procurement_doc_status', [
  'pending',
  'processing',
  'done',
  'failed',
])

// Workspace-scoped PO header. Mirrors `datasets` (storage+queue lifecycle),
// minus embedding — PO/invoice line items are compared via DuckDB, never
// chunked/embedded. `storageKey` is nullable and `sourceKind` defaults to
// 'csv' so A2 (PDF extraction) can attach a 'pdf-extraction' header with no
// CSV object, with no breaking migration.
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    poNumber: varchar('po_number', { length: 200 }),
    currency: varchar('currency', { length: 10 }),
    storageKey: text('storage_key'),
    sourceKind: varchar('source_kind', { length: 20 }).notNull().default('csv'),
    status: procurementDocStatusEnum('status').notNull().default('pending'),
    queueJobId: text('queue_job_id'),
    enqueuedAt: timestamp('enqueued_at'),
    processingStartedAt: timestamp('processing_started_at'),
    rowCount: integer('row_count'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index('purchase_orders_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
)

export type PurchaseOrder = typeof purchaseOrders.$inferSelect
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert
