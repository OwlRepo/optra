import { index, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { comparisonRuns } from './comparisonRuns'
import { discrepancyFlags } from './discrepancyFlags'
import { users } from './users'
import { workspaces } from './workspaces'

// POLICY v1 #7. `discrepancy_flags.status` stays two-state (open/dismissed)
// because every recorded decision closes the flag — a human has adjudicated
// it — and the nuance lives here instead. Teaching the flag status enum four
// new values would be this repo's first ALTER TYPE, on a forward-only deploy
// with no down migration, for a display distinction.
export const discrepancyDecisionOutcomeEnum = pgEnum('discrepancy_decision_outcome', [
  'false_positive',
  'approved_exception',
  'vendor_dispute',
  'resolved',
])

// Append-only. Nothing updates or deletes a row here: a decision that turns
// out to be wrong is corrected by recording another one, so the trail stays
// readable. That is the whole point of the table — before it, a dismissal was
// two mutable columns that a re-compare could erase (plan B1/B5).
export const discrepancyDecisions = pgTable(
  'discrepancy_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    discrepancyFlagId: uuid('discrepancy_flag_id')
      .references(() => discrepancyFlags.id, { onDelete: 'cascade' })
      .notNull(),
    // Which run's finding was being judged. Nullable for the same reason the
    // flag's own run is: flags written before S1 belong to no run.
    comparisonRunId: uuid('comparison_run_id').references(() => comparisonRuns.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Captured at decision time, not looked up later: the reviewer's role when
    // they decided is part of the record, and memberships change.
    actorRole: varchar('actor_role', { length: 20 }).notNull(),
    outcome: discrepancyDecisionOutcomeEnum('outcome').notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    flagCreatedIdx: index('discrepancy_decisions_flag_created_idx').on(
      table.workspaceId,
      table.discrepancyFlagId,
      table.createdAt,
    ),
  }),
)

export type DiscrepancyDecision = typeof discrepancyDecisions.$inferSelect
export type NewDiscrepancyDecision = typeof discrepancyDecisions.$inferInsert
