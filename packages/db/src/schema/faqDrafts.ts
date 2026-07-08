import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'
import { users } from './users'
import { workspaces } from './workspaces'

// V2 F4 (auto-generated FAQ from ticket clusters). A draft requires human
// approval before it can ever enter the retrieval corpus — hard invariant
// per the plan (LLM-authored content entering the corpus is Deep risk).
// Approval materializes the draft as a normal `documents` row through the
// EXISTING ingest pipeline (same pattern as scrape.processor.ts writing a
// .txt to storage then calling IngestService) — zero retrieval-side changes.
export const faqDraftStatusEnum = pgEnum('faq_draft_status', ['pending', 'approved', 'rejected'])

export const faqDrafts = pgTable(
  'faq_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    // Provenance: which tickets fed this draft, and how many were in the
    // cluster (drafts below MIN_CLUSTER_SIZE are never created at all).
    ticketIds: jsonb('ticket_ids').$type<string[]>().notNull(),
    clusterSize: integer('cluster_size').notNull(),
    status: faqDraftStatusEnum('status').notNull().default('pending'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('faq_drafts_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
  }),
)

export type FaqDraft = typeof faqDrafts.$inferSelect
export type NewFaqDraft = typeof faqDrafts.$inferInsert
