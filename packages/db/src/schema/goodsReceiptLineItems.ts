import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { goodsReceipts } from './goodsReceipts'
import { workspaces } from './workspaces'

// workspaceId is denormalized here (not derived via a goodsReceipts join) so
// every read stays a single indexed WHERE — same isolation shape as
// poLineItems/invoiceLineItems.
export const goodsReceiptLineItems = pgTable(
  'goods_receipt_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    goodsReceiptId: uuid('goods_receipt_id')
      .references(() => goodsReceipts.id, { onDelete: 'cascade' })
      .notNull(),
    lineNumber: integer('line_number'),
    sku: varchar('sku', { length: 200 }),
    description: text('description'),
    // Three named quantities rather than the single `quantity` the PO and
    // invoice line tables carry. Naming one of them `quantity` would make that
    // column mean ordered on one table, billed on another and received on a
    // third — knowable only by remembering which table you are reading.
    //
    // ALL NULLABLE, AND NULL IS NOT ZERO. §1B and POLICY v1 #14 both require
    // that missing receiving data is never read as "nothing was received" or
    // "nothing was accepted". A source that does not state an accepted quantity
    // stores NULL here, and S6's three-way match must treat that as "not
    // stated" rather than 0 — otherwise it invents rejections that never
    // happened. No DEFAULT may ever be added to these three columns.
    quantityReceived: numeric('quantity_received'),
    quantityAccepted: numeric('quantity_accepted'),
    quantityRejected: numeric('quantity_rejected'),
    // Captured, never converted (POLICY v1 #4).
    uom: varchar('uom', { length: 20 }),
    rawRow: jsonb('raw_row'),
    // Provenance, matching poLineItems minus the two PDF-only columns:
    // extraction_confidence and extractor_version are written only by the PDF
    // path, and PDF goods receipts are deferred in S5 (the extraction chain
    // cannot express received-vs-accepted). Shipping them now would mean two
    // permanently-null columns; they arrive with PDF support, additively.
    sourceSheet: varchar('source_sheet', { length: 200 }),
    sourceRow: integer('source_row'),
    sourceKind: varchar('source_kind', { length: 20 }).notNull().default('csv'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    goodsReceiptIdx: index('goods_receipt_line_items_goods_receipt_idx').on(table.goodsReceiptId),
    workspaceSkuIdx: index('goods_receipt_line_items_workspace_sku_idx').on(table.workspaceId, table.sku),
  }),
)

export type GoodsReceiptLineItem = typeof goodsReceiptLineItems.$inferSelect
export type NewGoodsReceiptLineItem = typeof goodsReceiptLineItems.$inferInsert
