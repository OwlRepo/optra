import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { purchaseOrders } from './purchaseOrders'
import { workspaces } from './workspaces'

// workspaceId is denormalized here (not derived via a purchaseOrders join)
// so every read stays a single indexed WHERE — same isolation shape as
// chunks.ts (parent id + workspaceId both on the row).
export const poLineItems = pgTable(
  'po_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    purchaseOrderId: uuid('purchase_order_id')
      .references(() => purchaseOrders.id, { onDelete: 'cascade' })
      .notNull(),
    lineNumber: integer('line_number'),
    sku: varchar('sku', { length: 200 }),
    description: text('description'),
    quantity: numeric('quantity'),
    unitPrice: numeric('unit_price'),
    lineTotal: numeric('line_total'),
    rawRow: jsonb('raw_row'),
    // Provenance (S3a). All nullable: which fields are knowable depends on the
    // source. CSV/XLSX know the row (and XLSX the sheet) but have no model
    // confidence; a PDF is the reverse. `source_page` is deliberately absent —
    // the extraction chain prompts over the whole document, so no honest page
    // number exists today (see the plan's S3a notes).
    sourceSheet: varchar('source_sheet', { length: 200 }),
    sourceRow: integer('source_row'),
    uom: varchar('uom', { length: 20 }),
    extractionConfidence: numeric('extraction_confidence'),
    extractorVersion: varchar('extractor_version', { length: 40 }),
    sourceKind: varchar('source_kind', { length: 20 }).notNull().default('csv'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    purchaseOrderIdx: index('po_line_items_purchase_order_idx').on(table.purchaseOrderId),
    workspaceSkuIdx: index('po_line_items_workspace_sku_idx').on(table.workspaceId, table.sku),
  }),
)

export type PoLineItem = typeof poLineItems.$inferSelect
export type NewPoLineItem = typeof poLineItems.$inferInsert
