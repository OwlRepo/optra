import { index, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { comparisonRuns } from './comparisonRuns'
import { goodsReceiptLineItems } from './goodsReceiptLineItems'
import { invoiceLineItems } from './invoiceLineItems'
import { invoices } from './invoices'
import { poLineItems } from './poLineItems'
import { purchaseOrders } from './purchaseOrders'
import { users } from './users'
import { vendorPriceTerms } from './vendorPriceTerms'
import { workspaces } from './workspaces'

// The four original values compare a purchase order against an invoice. S6 adds
// four more: two receiving exceptions that only a three-way run can produce, and
// two "needs review" cases where POLICY v1 #4/#6 say a delta must NOT be
// computed — the reason is kept as the type so a reviewer (and S7's queue) can
// tell a UOM problem from a currency one.
//
// This is the repo's first ALTER TYPE. §6.7 of the development plan sanctions it
// ("new enum values added through `ALTER TYPE … ADD VALUE`"), but note the
// constraint that comes with it: the migration may ADD these values and must
// never WRITE one, because on an already-migrated database the type predates the
// migration's transaction and Postgres refuses to use a value added inside it.
export const discrepancyFlagTypeEnum = pgEnum('discrepancy_flag_type', [
  'quantity_mismatch',
  'price_mismatch',
  'missing_on_invoice',
  'missing_on_po',
  'short_receipt',
  'invoice_exceeds_received',
  'uom_mismatch',
  'currency_mismatch',
  // S9. Both are about the AGREED price, never about the invoice — POLICY v1
  // #5 keeps the approved PO unit price authoritative for PO-vs-invoice, and
  // `price_mismatch` above keeps exactly the meaning it has always had.
  //
  // `contract_price_variance`: the order was placed at a price other than the
  // one on contract. Our own purchasing control, not an accusation.
  // `contract_price_unavailable`: a contract exists for this item but the
  // system will not say whether it was honoured — expired, ambiguous, or
  // stated in another unit or currency. §7.4 requires that this be an
  // exception rather than a silent match.
  'contract_price_variance',
  'contract_price_unavailable',
])

export const discrepancyFlagStatusEnum = pgEnum('discrepancy_flag_status', ['open', 'dismissed'])

// N-per-(PO,invoice) with provenance, modeled on documentReviewFlags: a
// comparison run can surface several independent mismatches, and dismissal
// is an audited per-flag action, not a boolean cleared on the header.
export const discrepancyFlags = pgTable(
  'discrepancy_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    purchaseOrderId: uuid('purchase_order_id')
      .references(() => purchaseOrders.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceId: uuid('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    // Which comparison run produced this flag. Nullable because every flag
    // written before S1 predates the runs table; those count as current for
    // their pair until that pair is compared again, so nothing disappears from
    // the UI when this ships. `set null` rather than cascade: runs are
    // append-only and never deleted, and a flag losing its run should degrade
    // to legacy, not vanish.
    comparisonRunId: uuid('comparison_run_id').references(() => comparisonRuns.id, { onDelete: 'set null' }),
    poLineItemId: uuid('po_line_item_id').references(() => poLineItems.id, { onDelete: 'set null' }),
    invoiceLineItemId: uuid('invoice_line_item_id').references(() => invoiceLineItems.id, {
      onDelete: 'set null',
    }),
    // S6. Which receipt line the accepted quantity came from, when the flag is a
    // receiving exception. `set null` for the same reason as its two siblings:
    // re-parsing a document replaces its line rows, and the flag's denormalized
    // values below are what keep the evidence readable afterwards.
    goodsReceiptLineItemId: uuid('goods_receipt_line_item_id').references(() => goodsReceiptLineItems.id, {
      onDelete: 'set null',
    }),
    sku: varchar('sku', { length: 200 }),
    flagType: discrepancyFlagTypeEnum('flag_type').notNull(),
    poValue: text('po_value'),
    invoiceValue: text('invoice_value'),
    // S6. The third number a three-way exception needs: accepted quantity,
    // summed across the receipts this run read. Null on every two-way flag and
    // on any line whose receipt did not state an accepted quantity — null here
    // means "not stated", never zero (POLICY v1 #14).
    receivedValue: text('received_value'),
    // S9. The unit prices behind the line, on every flag that has a line.
    //
    // Separate columns rather than reusing the three `*_value` fields above,
    // because those are `text` and already carry whatever the flag's own type
    // disputes — units on a `uom_mismatch` row, currency codes on a
    // `currency_mismatch` row. Nothing can be aggregated over a column that
    // sometimes holds "EA".
    //
    // Filled on `price_mismatch` too, duplicating `po_value`/`invoice_value`
    // there on purpose: a numeric column populated on one flag type only is
    // useless to read across the others. Null means the side did not state one
    // price — either it has no line at all, or its own duplicate lines disagree
    // — never a price the system chose.
    poUnitPrice: numeric('po_unit_price'),
    invoiceUnitPrice: numeric('invoice_unit_price'),
    // S9. The agreed price this line was judged against, and which term said
    // so. Only the two `contract_price_*` types fill them.
    //
    // Their own columns rather than a reuse of `invoice_value`: no invoice is
    // involved in a contract finding, and a column named for one holding a
    // contract price would be a lie a later reader has to disprove. The three
    // `*_value` columns already shift meaning by flag type (units on a UOM
    // row, currency codes on a currency row) and that is exactly as far as
    // that trick should be pushed.
    //
    // `contract_term_id` is `set null` for the same reason the line-item
    // references are: a term is never deleted, but if one ever were, the flag
    // must degrade to "we judged this against a contract" rather than vanish.
    // The denormalized price above is what keeps the evidence readable.
    contractUnitPrice: numeric('contract_unit_price'),
    contractTermId: uuid('contract_term_id').references(() => vendorPriceTerms.id, { onDelete: 'set null' }),
    delta: numeric('delta'),
    reason: text('reason').notNull(),
    status: discrepancyFlagStatusEnum('status').notNull().default('open'),
    dismissedAt: timestamp('dismissed_at'),
    dismissedBy: uuid('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('discrepancy_flags_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    poInvoiceIdx: index('discrepancy_flags_po_invoice_idx').on(table.purchaseOrderId, table.invoiceId),
    runIdx: index('discrepancy_flags_run_idx').on(table.comparisonRunId),
  }),
)

export type DiscrepancyFlag = typeof discrepancyFlags.$inferSelect
export type NewDiscrepancyFlag = typeof discrepancyFlags.$inferInsert
