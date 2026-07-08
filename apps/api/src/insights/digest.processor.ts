import { Injectable, Logger } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { eq } from 'drizzle-orm'
import { db, users, workspaces } from '@repo/db'
import { BackgroundRunsService } from './background-runs.service'
import { DigestContentService } from './digest-content.service'
import { DigestSettingsService } from './digest-settings.service'
import { renderDigestEmailHtml, renderDigestSlackPayload } from './digest-renderers'
import { NotificationsService } from '../notifications/notifications.service'

// V2 F6. Email and Slack are independent, best-effort channels: one failing
// (e.g. a since-revoked Slack webhook) must never block the other or fail
// the whole weekly run for a workspace that has both configured. Recipient
// for v1 is the workspace owner only — per-member digest preferences are a
// documented scope cut, not an oversight.
@Injectable()
@Processor('digest-queue')
export class DigestProcessor {
  private readonly logger = new Logger(DigestProcessor.name)

  constructor(
    private readonly digestContent: DigestContentService,
    private readonly digestSettings: DigestSettingsService,
    private readonly notifications: NotificationsService,
    private readonly runs: BackgroundRunsService,
  ) {}

  @Process()
  async onDigest(job: Job<{ workspaceId: string }>) {
    const { workspaceId } = job.data
    const runId = await this.runs.start('digest', workspaceId)

    try {
      const settings = await this.digestSettings.get(workspaceId)
      const content = await this.digestContent.build(workspaceId)

      let emailSent = false
      let emailError: string | null = null
      let slackSent = false
      let slackError: string | null = null

      if (settings.emailEnabled) {
        try {
          const [owner] = await db
            .select({ email: users.email })
            .from(workspaces)
            .innerJoin(users, eq(workspaces.ownerId, users.id))
            .where(eq(workspaces.id, workspaceId))

          if (owner) {
            await this.notifications.sendDigestEmail(owner.email, renderDigestEmailHtml(content))
            emailSent = true
          }
        } catch (error) {
          emailError = error instanceof Error ? error.message : String(error)
          this.logger.warn(`Digest email failed workspaceId=${workspaceId}: ${emailError}`)
        }
      }

      if (settings.slackEnabled && settings.slackWebhookUrl) {
        try {
          const { assertPublicUrl } = await import('@repo/ai')
          await assertPublicUrl(settings.slackWebhookUrl)

          const response = await fetch(settings.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(renderDigestSlackPayload(content)),
          })
          if (!response.ok) {
            throw new Error(`Slack webhook responded with status ${response.status}`)
          }
          slackSent = true
        } catch (error) {
          slackError = error instanceof Error ? error.message : String(error)
          this.logger.warn(`Digest Slack post failed workspaceId=${workspaceId}: ${slackError}`)
        }
      }

      await this.runs.succeed(runId, { emailSent, emailError, slackSent, slackError })
      this.logger.log(`Digest workspaceId=${workspaceId} emailSent=${emailSent} slackSent=${slackSent}`)
    } catch (error) {
      await this.runs.fail(runId, error)
      this.logger.error(
        `Digest failed workspaceId=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }
}
