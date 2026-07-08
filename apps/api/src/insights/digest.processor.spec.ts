import { eq } from 'drizzle-orm'
import { backgroundRuns, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { DigestProcessor } from './digest.processor'
import { DigestContentService } from './digest-content.service'
import { DigestSettingsService } from './digest-settings.service'
import { NotificationsService } from '../notifications/notifications.service'
import { BackgroundRunsService } from './background-runs.service'
import type { DigestContent } from './digest-content.service'

const { assertPublicUrl } = jest.requireMock('@repo/ai') as { assertPublicUrl: jest.Mock }

jest.mock('@repo/ai', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue(undefined),
}))

const QUIET_CONTENT: DigestContent = {
  workspaceId: 'ws',
  windowDays: 7,
  eventCounts: {},
  chatSummary: { totalQueries: 0, fallbackRate: 0, cacheHitRate: 0, avgTopScore: null },
  newFreshnessFlags: 0,
  newFaqDrafts: 0,
  newTickets: 0,
}

describe('DigestProcessor', () => {
  let digestContent: { build: jest.Mock }
  let digestSettings: { get: jest.Mock }
  let notifications: { sendDigestEmail: jest.Mock }
  let runs: BackgroundRunsService
  let processor: DigestProcessor
  let fetchMock: jest.Mock
  const prefix = `digest-processor-spec-${Date.now()}-`
  let workspaceId: string
  let ownerEmail: string

  beforeAll(async () => {
    ownerEmail = `${prefix}@example.com`
    const [user] = await db
      .insert(users)
      .values({ email: ownerEmail, passwordHash: 'x', isVerified: true })
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
    digestContent = { build: jest.fn().mockResolvedValue({ ...QUIET_CONTENT, workspaceId }) }
    digestSettings = { get: jest.fn().mockResolvedValue({ emailEnabled: false, slackWebhookUrl: null, slackEnabled: false }) }
    notifications = { sendDigestEmail: jest.fn().mockResolvedValue(undefined) }
    runs = new BackgroundRunsService()
    processor = new DigestProcessor(
      digestContent as unknown as DigestContentService,
      digestSettings as unknown as DigestSettingsService,
      notifications as unknown as NotificationsService,
      runs,
    )
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch
    await db.delete(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
  })

  it('sends only email when email is enabled and Slack is not configured', async () => {
    digestSettings.get.mockResolvedValue({ emailEnabled: true, slackWebhookUrl: null, slackEnabled: false })

    await processor.onDigest({ data: { workspaceId } } as never)

    expect(notifications.sendDigestEmail).toHaveBeenCalledWith(ownerEmail, expect.any(String))
    expect(fetchMock).not.toHaveBeenCalled()

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
    expect(run.stats).toMatchObject({ emailSent: true, slackSent: false })
  })

  it('posts to Slack (re-validating the URL) when configured, independent of email', async () => {
    digestSettings.get.mockResolvedValue({
      emailEnabled: false,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })

    await processor.onDigest({ data: { workspaceId } } as never)

    expect(assertPublicUrl).toHaveBeenCalledWith('https://hooks.slack.com/services/x')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/x',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(notifications.sendDigestEmail).not.toHaveBeenCalled()

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.stats).toMatchObject({ emailSent: false, slackSent: true })
  })

  it('records a per-channel error without failing the run when Slack post fails', async () => {
    digestSettings.get.mockResolvedValue({
      emailEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      slackEnabled: true,
    })
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    await processor.onDigest({ data: { workspaceId } } as never)

    expect(notifications.sendDigestEmail).toHaveBeenCalled()

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
    expect(run.stats).toMatchObject({ emailSent: true, slackSent: false })
    expect((run.stats as { slackError: string }).slackError).toContain('404')
  })

  it('records a per-channel error without failing the run when email sending fails', async () => {
    digestSettings.get.mockResolvedValue({ emailEnabled: true, slackWebhookUrl: null, slackEnabled: false })
    notifications.sendDigestEmail.mockRejectedValue(new Error('resend down'))

    await processor.onDigest({ data: { workspaceId } } as never)

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
    expect(run.stats).toMatchObject({ emailSent: false })
    expect((run.stats as { emailError: string }).emailError).toBe('resend down')
  })

  it('records a failed run and rethrows when building digest content throws', async () => {
    digestContent.build.mockRejectedValue(new Error('db down'))

    await expect(processor.onDigest({ data: { workspaceId } } as never)).rejects.toThrow('db down')

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('failed')
    expect(run.lastError).toBe('db down')
  })
})
