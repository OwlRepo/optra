import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const otps = pgTable('otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Otp = typeof otps.$inferSelect
export type NewOtp = typeof otps.$inferInsert
