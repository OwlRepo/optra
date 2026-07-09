import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { workspaces } from './workspaces'

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceId: uuid('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    lineNumber: integer('line_number'),
    sku: varchar('sku', { length: 200 }),
    description: text('description'),
    quantity: numeric('quantity'),
    unitPrice: numeric('unit_price'),
    lineTotal: numeric('line_total'),
    rawRow: jsonb('raw_row'),
    sourceKind: varchar('source_kind', { length: 20 }).notNull().default('csv'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdx: index('invoice_line_items_invoice_idx').on(table.invoiceId),
    workspaceSkuIdx: index('invoice_line_items_workspace_sku_idx').on(table.workspaceId, table.sku),
  }),
)

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert
