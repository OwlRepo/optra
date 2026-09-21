import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { procurementDocStatusEnum, purchaseOrders } from './purchaseOrders'
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
    // POLICY v1 #2: the user picks the PO at upload time. A PO number read out
    // of the document is advisory and never auto-links, so this is only ever
    // written from an explicit choice. Nullable for the same deploy reason as
    // `purchase_orders.vendor_id`; a null means "uploaded before S3b", which
    // `compare()` treats as the legacy path rather than a mismatch.
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
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
    workspacePoIdx: index('invoices_workspace_po_idx').on(table.workspaceId, table.purchaseOrderId),
  }),
)

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
