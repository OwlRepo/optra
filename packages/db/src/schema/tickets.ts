import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'

// V2 slice F2 (docs/ai/planning/v2-features.md): additive columns for
// structured ticket-trend querying. `category` is populated deterministically
// from the already-extracted `productArea` at write time (see
// TicketExtractionProcessor) — no LLM prompt change, zero risk to the
// existing extraction chain. `resolvedAt`/`assigneeId` are set via the
// existing ticket update endpoint, same as `reviewedAt`/`reviewedBy`.

export const ticketSeverityEnum = pgEnum('ticket_severity', ['low', 'medium', 'high'])
export const ticketStatusEnum = pgEnum('ticket_status', ['pending', 'processing', 'done', 'failed'])
export const ticketUsefulnessEnum = pgEnum('ticket_usefulness', ['useful', 'not_useful'])
export const ticketEditStateEnum = pgEnum('ticket_edit_state', ['accepted', 'heavily_edited'])

export interface TicketFieldConfidence {
  title?: number
  issueSummary?: number
  reproSteps?: number
  severity?: number
  productArea?: number
  hypothesizedRootCause?: number
  nextAction?: number
}

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  transcript: text('transcript').notNull(),
  transcriptHash: varchar('transcript_hash', { length: 64 }).notNull(),
  title: text('title'),
  issueSummary: text('issue_summary'),
  reproSteps: text('repro_steps'),
  severity: ticketSeverityEnum('severity'),
  productArea: text('product_area').notNull().default('general'),
  hypothesizedRootCause: text('hypothesized_root_cause'),
  nextAction: text('next_action'),
  status: ticketStatusEnum('status').notNull().default('pending'),
  queueJobId: text('queue_job_id'),
  enqueuedAt: timestamp('enqueued_at'),
  processingStartedAt: timestamp('processing_started_at'),
  lastError: text('last_error'),
  fieldConfidence: jsonb('field_confidence').$type<TicketFieldConfidence>().notNull().default({}),
  usefulness: ticketUsefulnessEnum('usefulness'),
  editState: ticketEditStateEnum('edit_state'),
  feedbackNote: text('feedback_note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  category: text('category'),
  resolvedAt: timestamp('resolved_at'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  workspaceTranscriptHashUniqueIdx: uniqueIndex('tickets_workspace_transcript_hash_idx').on(
    table.workspaceId,
    table.transcriptHash,
  ),
}))

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
