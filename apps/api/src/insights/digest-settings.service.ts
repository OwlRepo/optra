import { BadRequestException, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { db, workspaceDigestSettings } from '@repo/db'

export interface UpdateDigestSettingsInput {
  emailEnabled?: boolean
  slackWebhookUrl?: string | null
}

const DEFAULT_SETTINGS = { emailEnabled: true, slackWebhookUrl: null as string | null, slackEnabled: false }

@Injectable()
export class DigestSettingsService {
  async get(workspaceId: string) {
    const [row] = await db
      .select()
      .from(workspaceDigestSettings)
      .where(eq(workspaceDigestSettings.workspaceId, workspaceId))

    return row ?? { workspaceId, ...DEFAULT_SETTINGS }
  }

  // Slack webhook URLs are user-supplied — validated with the SSRF guard
  // BEFORE ever being persisted, same discipline as the crawler validating a
  // seed URL before queueing. Validated again at send time in DigestProcessor
  // (defense in depth: a URL safe today could resolve differently later).
  // PATCH semantics: only fields present on `input` change; everything else
  // keeps its current (or default, on first save) value.
  async update(workspaceId: string, input: UpdateDigestSettingsInput) {
    if (input.slackWebhookUrl) {
      const { assertPublicUrl } = await import('@repo/ai')
      try {
        await assertPublicUrl(input.slackWebhookUrl)
      } catch (error) {
        throw new BadRequestException(
          `Slack webhook URL rejected: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const [existing] = await db
      .select()
      .from(workspaceDigestSettings)
      .where(eq(workspaceDigestSettings.workspaceId, workspaceId))

    const base = existing ?? { ...DEFAULT_SETTINGS }
    const emailEnabled = 'emailEnabled' in input ? input.emailEnabled! : base.emailEnabled
    const slackWebhookUrl = 'slackWebhookUrl' in input ? input.slackWebhookUrl ?? null : base.slackWebhookUrl
    const slackEnabled = Boolean(slackWebhookUrl)

    if (existing) {
      const [updated] = await db
        .update(workspaceDigestSettings)
        .set({ emailEnabled, slackWebhookUrl, slackEnabled, updatedAt: new Date() })
        .where(eq(workspaceDigestSettings.id, existing.id))
        .returning()
      return updated
    }

    const [created] = await db
      .insert(workspaceDigestSettings)
      .values({ workspaceId, emailEnabled, slackWebhookUrl, slackEnabled })
      .returning()
    return created
  }
}
