import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    contactInfo: text('contact_info'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameIdx: index('vendors_workspace_name_idx').on(table.workspaceId, table.name),
  }),
)

export type Vendor = typeof vendors.$inferSelect
export type NewVendor = typeof vendors.$inferInsert
