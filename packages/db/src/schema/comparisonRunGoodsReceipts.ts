import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'
import { comparisonRuns } from './comparisonRuns'
import { goodsReceipts } from './goodsReceipts'

// Which goods receipts a comparison run actually consumed (S6).
//
// A join table rather than a column on `comparison_runs`, because POLICY v1 #14
// sums accepted quantity "across every GRN linked to the PO" — a run routinely
// reads more than one receipt, and a single `goods_receipt_id` could not say
// which. (An earlier S5 note proposed exactly that singular column; it was
// wrong, and the risk register and repository map are corrected alongside this.)
//
// Recorded rather than re-derived at read time: §1E requires a run to identify
// its "source document IDs", and runs are append-only evidence. Uploading a
// third receipt tomorrow must not change what yesterday's run says it compared.
//
// No workspaceId here: both sides are already workspace-scoped and cascade from
// the same workspace, and a join row carries no tenant data of its own.
export const comparisonRunGoodsReceipts = pgTable(
  'comparison_run_goods_receipts',
  {
    comparisonRunId: uuid('comparison_run_id')
      .references(() => comparisonRuns.id, { onDelete: 'cascade' })
      .notNull(),
    goodsReceiptId: uuid('goods_receipt_id')
      .references(() => goodsReceipts.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.comparisonRunId, table.goodsReceiptId] }),
    // Serves POLICY v1 #9's retention guard, which asks the reverse question:
    // "is this receipt referenced by any run?"
    goodsReceiptIdx: index('comparison_run_goods_receipts_receipt_idx').on(table.goodsReceiptId),
  }),
)

export type ComparisonRunGoodsReceipt = typeof comparisonRunGoodsReceipts.$inferSelect
export type NewComparisonRunGoodsReceipt = typeof comparisonRunGoodsReceipts.$inferInsert
