import { BadRequestException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { db, pool, users, workspaceDigestSettings, workspaceMembers, workspaces } from '@repo/db'
import { DigestSettingsService } from './digest-settings.service'

const { assertPublicUrl } = jest.requireMock('@repo/ai') as { assertPublicUrl: jest.Mock }

jest.mock('@repo/ai', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue(undefined),
}))

describe('DigestSettingsService', () => {
  let service: DigestSettingsService
  const prefix = `digest-settings-spec-${Date.now()}-`
  let workspaceId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    assertPublicUrl.mockResolvedValue(undefined)
    service = new DigestSettingsService()
    await db.delete(workspaceDigestSettings).where(eq(workspaceDigestSettings.workspaceId, workspaceId))
  })

  it('returns workspace-scoped defaults when no row exists yet', async () => {
    const settings = await service.get(workspaceId)

    expect(settings).toMatchObject({ emailEnabled: true, slackWebhookUrl: null, slackEnabled: false })
  })

  it('creates a row on first update, validating the Slack webhook URL', async () => {
    const settings = await service.update(workspaceId, { slackWebhookUrl: 'https://hooks.slack.com/services/x' })

    expect(assertPublicUrl).toHaveBeenCalledWith('https://hooks.slack.com/services/x')
    expect(settings).toMatchObject({
      emailEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })
  })

  it('rejects a Slack webhook URL that fails the SSRF guard', async () => {
    assertPublicUrl.mockRejectedValue(new Error('Blocked non-public URL: private IP 10.0.0.1'))

    await expect(
      service.update(workspaceId, { slackWebhookUrl: 'https://10.0.0.1/webhook' }),
    ).rejects.toThrow(BadRequestException)
  })

  it('preserves existing fields on a partial update (PATCH semantics)', async () => {
    await service.update(workspaceId, { emailEnabled: false, slackWebhookUrl: 'https://hooks.slack.com/services/x' })

    const updated = await service.update(workspaceId, { emailEnabled: true })

    expect(updated).toMatchObject({
      emailEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })
  })

  it('clearing the webhook URL disables Slack', async () => {
    await service.update(workspaceId, { slackWebhookUrl: 'https://hooks.slack.com/services/x' })

    const updated = await service.update(workspaceId, { slackWebhookUrl: null })

    expect(updated).toMatchObject({ slackWebhookUrl: null, slackEnabled: false })
  })
})
