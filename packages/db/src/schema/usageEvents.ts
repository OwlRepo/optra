import { bigint, index, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

// matched_line: quantity = the PO's line count, one row per PO/invoice pair.
// photo_check: quantity = 1, one row per catalog search that reaches the model.
// llm_cost:   quantity = micro-USD (1 USD = 1,000,000) priced by packages/ai
//             pricing.ts, with the token split and model kept for audit.
export const usageKindEnum = pgEnum('usage_kind', ['matched_line', 'photo_check', 'llm_cost'])

// Append-only billing ledger (slice S4). Rows are written only by
// apps/api/src/billing/usage-ledger.service.ts. occurred_at keeps the repo's
// `timestamp` (no zone) convention and the app ALWAYS writes it from its own
// clock (UTC), never from the database default, so period sums are not
// sensitive to the DB session time zone.
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    kind: usageKindEnum('kind').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    model: varchar('model', { length: 64 }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceKindOccurredIdx: index('usage_events_workspace_kind_occurred_idx').on(
      table.workspaceId,
      table.kind,
      table.occurredAt,
    ),
    idempotencyKeyUniqueIdx: uniqueIndex('usage_events_idempotency_key_unique').on(table.idempotencyKey),
  }),
)

export type UsageEvent = typeof usageEvents.$inferSelect
export type NewUsageEvent = typeof usageEvents.$inferInsert
