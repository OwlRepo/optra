import { pgEnum, pgTable, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { knowledgeBases } from './knowledgeBases'
import { workspaces } from './workspaces'

export const scrapeRunStatusEnum = pgEnum('scrape_run_status', [
  'queued',
  'running',
  'completed',
  'failed',
])

export const scrapeRuns = pgTable('scrape_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  knowledgeBaseId: uuid('knowledge_base_id')
    .references(() => knowledgeBases.id, { onDelete: 'cascade' })
    .notNull(),
  seedUrl: text('seed_url').notNull(),
  status: scrapeRunStatusEnum('status').notNull().default('queued'),
  queueJobId: text('queue_job_id'),
  enqueuedAt: timestamp('enqueued_at'),
  maxDepth: integer('max_depth').notNull(),
  maxPages: integer('max_pages').notNull(),
  pagesFound: integer('pages_found').notNull().default(0),
  pagesSucceeded: integer('pages_succeeded').notNull().default(0),
  pagesFailed: integer('pages_failed').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at'),
  lastProgressAt: timestamp('last_progress_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type ScrapeRun = typeof scrapeRuns.$inferSelect
export type NewScrapeRun = typeof scrapeRuns.$inferInsert
