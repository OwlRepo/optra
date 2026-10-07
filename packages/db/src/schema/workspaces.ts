import { boolean, pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // App-side free trial (no card). Set once, in auth.service.ts#verifyOtp, on a
  // user's first workspace only. NULL = no trial (every other workspace).
  trialEndsAt: timestamp('trial_ends_at'),
  // Set by hand (SQL runbook, S5) for workspaces that predate billing.
  billingExempt: boolean('billing_exempt').notNull().default(false),
})

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
