import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

// Anchor row for periodic/background jobs (V2 S2 scheduler substrate) that
// have no natural entity to carry status/lastError on, unlike documents or
// datasets. workspaceId is nullable because some kinds (future: a global
// digest tick) may fan out per-workspace rows themselves rather than being
// scoped to one; F3's freshness-check kind always sets it.
export const backgroundRunStatusEnum = pgEnum('background_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])

export const backgroundRuns = pgTable(
  'background_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: backgroundRunStatusEnum('status').notNull().default('queued'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    lastError: text('last_error'),
    stats: jsonb('stats').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    kindCreatedIdx: index('background_runs_kind_created_idx').on(table.kind, table.createdAt),
    workspaceKindIdx: index('background_runs_workspace_kind_idx').on(table.workspaceId, table.kind),
  }),
)

export type BackgroundRun = typeof backgroundRuns.$inferSelect
export type NewBackgroundRun = typeof backgroundRuns.$inferInsert
