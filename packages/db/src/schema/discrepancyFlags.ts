import { index, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { comparisonRuns } from './comparisonRuns'
import { invoiceLineItems } from './invoiceLineItems'
import { invoices } from './invoices'
import { poLineItems } from './poLineItems'
import { purchaseOrders } from './purchaseOrders'
import { users } from './users'
import { workspaces } from './workspaces'

export const discrepancyFlagTypeEnum = pgEnum('discrepancy_flag_type', [
  'quantity_mismatch',
  'price_mismatch',
  'missing_on_invoice',
  'missing_on_po',
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
    sku: varchar('sku', { length: 200 }),
    flagType: discrepancyFlagTypeEnum('flag_type').notNull(),
    poValue: text('po_value'),
    invoiceValue: text('invoice_value'),
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
