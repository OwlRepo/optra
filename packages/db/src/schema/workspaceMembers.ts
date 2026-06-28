import { pgTable, uuid, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { users } from './users'

export const workspaceMemberRoleEnum = pgEnum('workspace_member_role', [
  'owner',
  'admin',
  'member',
])

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  role: workspaceMemberRoleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
})

export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert
