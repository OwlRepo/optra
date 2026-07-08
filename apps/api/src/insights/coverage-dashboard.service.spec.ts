import { eq } from 'drizzle-orm'
import { chatMessages, chatQueryMetrics, chatSessions, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { CoverageDashboardService } from './coverage-dashboard.service'

describe('CoverageDashboardService', () => {
  let redis: { get: jest.Mock }
  let service: CoverageDashboardService
  const prefix = `coverage-dashboard-spec-${Date.now()}-`
  let workspaceId: string
  let sessionId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id

    const [session] = await db
      .insert(chatSessions)
      .values({ workspaceId, userId: user.id, title: 'spec session' })
      .returning()
    sessionId = session.id
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    redis = { get: jest.fn() }
    service = new CoverageDashboardService(redis as unknown as never)
    await db.delete(chatQueryMetrics).where(eq(chatQueryMetrics.workspaceId, workspaceId))
  })

  async function seedMetric(overrides: {
    isFallback?: boolean
    cacheStatus?: string
    topScore?: number | null
    question?: string
  }) {
    const [message] = await db
      .insert(chatMessages)
      .values({ sessionId, role: 'assistant', content: 'a' })
      .returning()

    await db.insert(chatQueryMetrics).values({
      workspaceId,
      sessionId,
      chatMessageId: message.id,
      question: overrides.question ?? 'a question',
      isFallback: overrides.isFallback ?? false,
      cacheStatus: overrides.cacheStatus ?? 'miss',
      queryClass: 'complex',
      topScore: 'topScore' in overrides ? overrides.topScore : 0.9,
      latencyMs: 100,
    })
  }

  it('computes fallback rate, cache hit rate, and avg top score', async () => {
    await seedMetric({ isFallback: false, cacheStatus: 'exact', topScore: 0.9 })
    await seedMetric({ isFallback: false, cacheStatus: 'semantic', topScore: 0.8 })
    await seedMetric({ isFallback: true, cacheStatus: 'miss', topScore: null })
    await seedMetric({ isFallback: false, cacheStatus: 'miss', topScore: 0.7 })

    const summary = await service.getSummary(workspaceId)

    expect(summary.totalQueries).toBe(4)
    expect(summary.fallbackRate).toBeCloseTo(0.25)
    expect(summary.cacheHitRate).toBeCloseTo(0.5)
    expect(summary.avgTopScore).toBeCloseTo(0.8) // (0.9+0.8+0.7)/3
  })

  it('returns a zeroed summary when there are no queries in the window', async () => {
    const summary = await service.getSummary(workspaceId)

    expect(summary).toEqual({ totalQueries: 0, fallbackRate: 0, cacheHitRate: 0, avgTopScore: null })
  })

  it('lists fallback and low-score queries, newest first, excluding good matches', async () => {
    await seedMetric({ question: 'good match', isFallback: false, topScore: 0.9 })
    await seedMetric({ question: 'fallback question', isFallback: true, topScore: null })
    await seedMetric({ question: 'low score question', isFallback: false, topScore: 0.1 })

    const rows = await service.getLowScoreQueries(workspaceId)

    expect(rows.map((row) => row.question).sort()).toEqual(['fallback question', 'low score question'])
  })

  it('returns an empty array when no topic gaps have been cached yet', async () => {
    redis.get.mockResolvedValue(null)

    expect(await service.getTopicGaps(workspaceId)).toEqual([])
  })

  it('returns the cached topic gaps when present', async () => {
    redis.get.mockResolvedValue(JSON.stringify([{ label: 'SSO issues', questionCount: 5, exampleQuestion: 'q' }]))

    const gaps = await service.getTopicGaps(workspaceId)

    expect(gaps).toEqual([{ label: 'SSO issues', questionCount: 5, exampleQuestion: 'q' }])
  })
})
