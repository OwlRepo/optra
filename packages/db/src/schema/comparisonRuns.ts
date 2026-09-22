import { index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { purchaseOrders } from './purchaseOrders'
import { users } from './users'
import { workspaces } from './workspaces'

// 'queued' is unused today — comparison runs synchronously inside the request.
// It ships now because this repo has never altered a Postgres enum (no
// migration in 0000..0021 contains ALTER TYPE / ADD VALUE) and deploys are
// forward-only with no down migration, so the one value S8 needs when
// comparison moves onto Bull costs nothing here and avoids writing the repo's
// first enum alteration later.
export const comparisonRunStatusEnum = pgEnum('comparison_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])

// One row per comparison attempt. Before this table a comparison was an event
// with no record: re-running deleted the previous flag set, taking any human
// dismissal with it. Runs are append-only, flags point back at the run that
// produced them, and "current" means the latest succeeded run for the pair.
//
// `mode` is varchar, not an enum, on purpose — same escape hatch as
// `purchaseOrders.sourceKind`, so S6 can add 'three_way' with no migration.
//
// The line counts are what make a stale run detectable: re-parsing a document
// deletes and re-inserts its line items, which nulls each flag's line FK
// (`onDelete: 'set null'`). The flag's own sku/values/delta/reason are
// denormalized so the evidence survives, and a count that no longer matches
// the document says the run predates that re-parse.
export const comparisonRuns = pgTable(
  'comparison_runs',
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
    mode: varchar('mode', { length: 20 }).notNull().default('two_way'),
    strategyVersion: integer('strategy_version').notNull().default(1),
    status: comparisonRunStatusEnum('status').notNull().default('running'),
    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    poLineCount: integer('po_line_count'),
    invoiceLineCount: integer('invoice_line_count'),
    // S6. Null on a two-way run; on a three-way run, how many receipt lines were
    // summed. Which receipts those were lives in comparison_run_goods_receipts.
    goodsReceiptLineCount: integer('goods_receipt_line_count'),
    flagCount: integer('flag_count'),
    // S9. How many agreed prices this run had to judge against. Null when the
    // purchase order has no vendor, or the vendor has no terms for any of its
    // items — which is not the same as zero, and zero is not the same as "we
    // did not look". Deliberately a count rather than a join table: terms are
    // workspace rows, not documents, so POLICY v1 #9's retention guard has
    // nothing to protect here, and each flag already names the exact term it
    // used.
    contractTermCount: integer('contract_term_count'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index('comparison_runs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    // Serves the hot query: the latest succeeded run for a PO/invoice pair.
    pairStatusIdx: index('comparison_runs_pair_status_idx').on(
      table.purchaseOrderId,
      table.invoiceId,
      table.status,
      table.createdAt,
    ),
  }),
)

export type ComparisonRun = typeof comparisonRuns.$inferSelect
export type NewComparisonRun = typeof comparisonRuns.$inferInsert
