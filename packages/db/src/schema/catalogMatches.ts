import { boolean, index, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalogItems'
import { invoiceLineItems } from './invoiceLineItems'
import { poLineItems } from './poLineItems'
import { users } from './users'
import { vendors } from './vendors'
import { workspaces } from './workspaces'

export const catalogMatchTypeEnum = pgEnum('catalog_match_type', ['sourcing', 'compliance'])

export const catalogMatchStatusEnum = pgEnum('catalog_match_status', ['open', 'dismissed'])

export const catalogMatches = pgTable(
  'catalog_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    matchType: catalogMatchTypeEnum('match_type').notNull(),
    queryPoLineItemId: uuid('query_po_line_item_id').references(() => poLineItems.id, { onDelete: 'set null' }),
    queryInvoiceLineItemId: uuid('query_invoice_line_item_id').references(() => invoiceLineItems.id, {
      onDelete: 'set null',
    }),
    catalogItemId: uuid('catalog_item_id')
      .references(() => catalogItems.id, { onDelete: 'cascade' })
      .notNull(),
    vendorId: uuid('vendor_id')
      .references(() => vendors.id, { onDelete: 'cascade' })
      .notNull(),
    score: numeric('score'),
    isMatch: boolean('is_match').notNull(),
    reason: text('reason').notNull(),
    status: catalogMatchStatusEnum('status').notNull().default('open'),
    dismissedAt: timestamp('dismissed_at'),
    dismissedBy: uuid('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('catalog_matches_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    itemIdx: index('catalog_matches_item_idx').on(table.catalogItemId),
  }),
)

export type CatalogMatch = typeof catalogMatches.$inferSelect
export type NewCatalogMatch = typeof catalogMatches.$inferInsert
