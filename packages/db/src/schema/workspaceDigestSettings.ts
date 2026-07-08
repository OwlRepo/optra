import { boolean, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

// V2 F6 (Slack + email digest). One row per workspace, not a new column on
// workspaces — avoids widening that hot table for a feature most workspaces
// won't configure. slackWebhookUrl is user-supplied and validated with the
// SSRF guard (packages/ai/src/web/ssrf.ts) both on save and again at send
// time (defense in depth, same pattern as the crawler).
export const workspaceDigestSettings = pgTable(
  'workspace_digest_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    slackWebhookUrl: text('slack_webhook_url'),
    slackEnabled: boolean('slack_enabled').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdUniqueIdx: uniqueIndex('workspace_digest_settings_workspace_id_unique').on(table.workspaceId),
  }),
)

export type WorkspaceDigestSettings = typeof workspaceDigestSettings.$inferSelect
export type NewWorkspaceDigestSettings = typeof workspaceDigestSettings.$inferInsert
