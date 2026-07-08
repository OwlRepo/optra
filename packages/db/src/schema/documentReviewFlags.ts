import { index, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'
import { tickets } from './tickets'
import { users } from './users'
import { workspaces } from './workspaces'

// V2 F3 (runbook/SOP freshness detector). Deliberately N-per-document with
// provenance, not a boolean "needs review" column on documents: a document
// can accumulate several independent mismatch signals over time, each tied
// to the specific ticket that surfaced it, and dismissal is an audited
// per-flag action (who, when) rather than clearing shared document state.
export const documentReviewFlagStatusEnum = pgEnum('document_review_flag_status', [
  'open',
  'dismissed',
])

export const documentReviewFlags = pgTable(
  'document_review_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    documentId: uuid('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    // Provenance: which ticket-derived chunk surfaced the mismatch, and how
    // weak the best cosine match to this document's chunks was.
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    score: real('score'),
    reason: text('reason').notNull(),
    status: documentReviewFlagStatusEnum('status').notNull().default('open'),
    dismissedAt: timestamp('dismissed_at'),
    dismissedBy: uuid('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('document_review_flags_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    documentIdx: index('document_review_flags_document_idx').on(table.documentId),
  }),
)

export type DocumentReviewFlag = typeof documentReviewFlags.$inferSelect
export type NewDocumentReviewFlag = typeof documentReviewFlags.$inferInsert
