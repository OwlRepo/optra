import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { procurementDocStatusEnum, purchaseOrders } from './purchaseOrders'
import { workspaces } from './workspaces'

// The receiving side of the three-document set (S5). Same header lifecycle as
// purchaseOrders/invoices — storage key, queue fields, status — but no money:
// a receipt records what arrived, not what it cost, so there is no currency
// here and no unit price on its lines. POLICY v1 #1 declares exactly SKU,
// description, qty received/accepted/rejected and UOM, and hard stop #1
// forbids inventing fields beyond it.
//
// There is deliberately no `vendorId`: POLICY v1 #3 says the invoice and the
// GRN inherit the linked PO's vendor, so it is reached through the link below.
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    // NOT NULL, unlike invoices.purchase_order_id. That column had to stay
    // nullable because rows written before migration 0025 exist; this table is
    // new and has none, so POLICY v1 #2's "the user selects the PO" is
    // expressed in the schema rather than only in a DTO. A receipt that
    // answers no order is not evidence of anything.
    //
    // Cascade, not set null, for the same reason: without its order the row
    // cannot mean anything. Note this FK is NOT unique — POLICY v1 #14 allows
    // many receipts against one PO, and nothing here may imply otherwise.
    purchaseOrderId: uuid('purchase_order_id')
      .references(() => purchaseOrders.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    grnNumber: varchar('grn_number', { length: 200 }),
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
    workspaceCreatedIdx: index('goods_receipts_workspace_created_idx').on(table.workspaceId, table.createdAt),
    workspacePoIdx: index('goods_receipts_workspace_po_idx').on(table.workspaceId, table.purchaseOrderId),
  }),
)

export type GoodsReceipt = typeof goodsReceipts.$inferSelect
export type NewGoodsReceipt = typeof goodsReceipts.$inferInsert
