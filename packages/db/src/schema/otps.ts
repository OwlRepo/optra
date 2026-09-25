import { pgTable, uuid, varchar, timestamp, integer } from 'drizzle-orm/pg-core'
import { users } from './users'

export const otps = pgTable('otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  // Guesses at this code, reserved before each comparison. At 5 it stops
  // being accepted, from any address (AuthService.verifyOtp); a new one comes
  // from /auth/resend-otp.
  failedAttempts: integer('failed_attempts').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Otp = typeof otps.$inferSelect
export type NewOtp = typeof otps.$inferInsert
