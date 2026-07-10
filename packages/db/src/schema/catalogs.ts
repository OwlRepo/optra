import { index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { vendors } from './vendors'
import { workspaces } from './workspaces'

export const catalogDocStatusEnum = pgEnum('catalog_doc_status', [
  'pending',
  'processing',
  'done',
  'failed',
])

export const catalogs = pgTable(
  'catalogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    vendorId: uuid('vendor_id')
      .references(() => vendors.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    sourceKind: varchar('source_kind', { length: 20 }).notNull().default('upload'),
    storageKey: text('storage_key'),
    seedUrl: text('seed_url'),
    status: catalogDocStatusEnum('status').notNull().default('pending'),
    queueJobId: text('queue_job_id'),
    enqueuedAt: timestamp('enqueued_at'),
    processingStartedAt: timestamp('processing_started_at'),
    rowCount: integer('row_count'),
    lastError: text('last_error'),
    pagesFound: integer('pages_found'),
    pagesSucceeded: integer('pages_succeeded'),
    pagesFailed: integer('pages_failed'),
    lastProgressAt: timestamp('last_progress_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceVendorIdx: index('catalogs_workspace_vendor_idx').on(table.workspaceId, table.vendorId),
    workspaceCreatedIdx: index('catalogs_workspace_created_idx').on(table.workspaceId, table.createdAt),
  }),
)

export type Catalog = typeof catalogs.$inferSelect
export type NewCatalog = typeof catalogs.$inferInsert
