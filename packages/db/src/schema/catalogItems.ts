import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { catalogs } from './catalogs'
import { workspaces } from './workspaces'

// workspaceId is denormalized here (not derived via a catalogs join) so
// every read stays a single indexed WHERE — same isolation shape as
// poLineItems.ts / chunks.ts.
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    catalogId: uuid('catalog_id')
      .references(() => catalogs.id, { onDelete: 'cascade' })
      .notNull(),
    lineNumber: integer('line_number'),
    sku: varchar('sku', { length: 200 }),
    description: text('description'),
    photoStorageKey: text('photo_storage_key'),
    sourcePageNumber: integer('source_page_number'),
    rawRow: jsonb('raw_row'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    catalogIdx: index('catalog_items_catalog_idx').on(table.catalogId),
    workspaceSkuIdx: index('catalog_items_workspace_sku_idx').on(table.workspaceId, table.sku),
  }),
)

export type CatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert
