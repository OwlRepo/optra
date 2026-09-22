import { index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { vendors } from './vendors'
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
    // POLICY v1 #3: the vendor is chosen explicitly from the workspace's own
    // `vendors` rows at upload time — never inferred from the document. The
    // upload DTO requires it, but the column stays nullable: migrations run on
    // API start against a database the previous image is still serving, so a
    // NOT NULL column with no default would fail on existing rows mid-deploy.
    // A null here means "uploaded before S3b", and every read must allow it.
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    // S9. When the order was PLACED, as stated by whoever uploaded it —
    // distinct from `createdAt`, which is when the file reached Optra.
    // Contract applicability asks which agreed price was live at the moment of
    // ordering, and without this the only answer available is the upload date,
    // so a January order uploaded in June would be judged against June's
    // contract and flagged as a variance that never happened.
    //
    // Nullable, and optional at upload: every row written before this migration
    // has none, and a genuine "I don't know" must stay uploadable. Readers fall
    // back to `createdAt` and say so.
    orderedAt: timestamp('ordered_at'),
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
    workspaceVendorIdx: index('purchase_orders_workspace_vendor_idx').on(table.workspaceId, table.vendorId),
  }),
)

export type PurchaseOrder = typeof purchaseOrders.$inferSelect
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert
