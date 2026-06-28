import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Invitation = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert
