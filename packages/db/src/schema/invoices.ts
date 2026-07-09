import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { procurementDocStatusEnum } from './purchaseOrders'
import { workspaces } from './workspaces'

// Same shape as purchaseOrders (invoiceNumber instead of poNumber). Kept as
// a distinct table rather than a polymorphic "procurement_documents" table
// so PO- and invoice-specific fields can diverge later without a shared-
// table migration.
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    invoiceNumber: varchar('invoice_number', { length: 200 }),
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
    workspaceCreatedIdx: index('invoices_workspace_created_idx').on(table.workspaceId, table.createdAt),
  }),
)

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
