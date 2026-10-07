import { integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const billingPlanEnum = pgEnum('billing_plan', ['solo', 'team'])

// One row per workspace (1:1), written only from a signed Lemon Squeezy
// webhook. Same shape as workspace_digest_settings: a separate table so the
// hot workspaces table stays narrow. status is the LS status as received
// (on_trial, active, paused, past_due, unpaid, cancelled, expired), not an enum,
// so a new LS status never needs a migration.
export const workspaceSubscriptions = pgTable(
  'workspace_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    lsSubscriptionId: varchar('ls_subscription_id', { length: 64 }).notNull(),
    lsCustomerId: varchar('ls_customer_id', { length: 64 }).notNull(),
    lsVariantId: varchar('ls_variant_id', { length: 64 }).notNull(),
    plan: billingPlanEnum('plan').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    seats: integer('seats').notNull().default(1),
    renewsAt: timestamp('renews_at'),
    endsAt: timestamp('ends_at'),
    lsUpdatedAt: timestamp('ls_updated_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdUniqueIdx: uniqueIndex('workspace_subscriptions_workspace_id_unique').on(table.workspaceId),
    lsSubscriptionIdUniqueIdx: uniqueIndex('workspace_subscriptions_ls_subscription_id_unique').on(table.lsSubscriptionId),
  }),
)

export type WorkspaceSubscription = typeof workspaceSubscriptions.$inferSelect
export type NewWorkspaceSubscription = typeof workspaceSubscriptions.$inferInsert
