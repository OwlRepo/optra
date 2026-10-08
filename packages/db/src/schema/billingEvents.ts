import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

// Every distinct webhook delivery, stored before it is processed. Deliberately
// no workspace_id and no FK: a delivery that names an unknown workspace must
// still be recorded (last_error says why). body_sha256 unique makes an exact
// Lemon Squeezy retry a no-op once processed_at is set.
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventName: varchar('event_name', { length: 64 }).notNull(),
    bodySha256: varchar('body_sha256', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    lastError: text('last_error'),
  },
  (table) => ({
    bodySha256UniqueIdx: uniqueIndex('billing_events_body_sha256_unique').on(table.bodySha256),
  }),
)

export type BillingEvent = typeof billingEvents.$inferSelect
export type NewBillingEvent = typeof billingEvents.$inferInsert
