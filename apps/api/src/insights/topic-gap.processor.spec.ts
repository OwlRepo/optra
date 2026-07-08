import { eq } from 'drizzle-orm'
import { backgroundRuns, chatMessages, chatQueryMetrics, chatSessions, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { TopicGapProcessor } from './topic-gap.processor'
import { FaqClusterService } from './faq-cluster.service'
import { BackgroundRunsService } from './background-runs.service'
import { topicGapsRedisKey } from './coverage-dashboard.service'

const { generateTopicLabel } = jest.requireMock('@repo/ai') as { generateTopicLabel: jest.Mock }

jest.mock('@repo/ai', () => ({
  generateTopicLabel: jest.fn(),
}))

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.01)
}

describe('TopicGapProcessor', () => {
  let redis: { set: jest.Mock; get: jest.Mock }
  let clusterer: { cluster: jest.Mock }
  let runs: BackgroundRunsService
  let processor: TopicGapProcessor
  const prefix = `topic-gap-processor-spec-${Date.now()}-`
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
    jest.clearAllMocks()
    redis = { set: jest.fn().mockResolvedValue('OK'), get: jest.fn() }
    clusterer = { cluster: jest.fn() }
    runs = new BackgroundRunsService()
    processor = new TopicGapProcessor(
      redis as unknown as never,
      clusterer as unknown as FaqClusterService,
      runs,
    )
    await db.delete(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    await db.delete(chatQueryMetrics).where(eq(chatQueryMetrics.workspaceId, workspaceId))
  })

  async function seedFallbackMetric(question: string, embeddingSeed: number) {
    const [message] = await db
      .insert(chatMessages)
      .values({ sessionId, role: 'assistant', content: 'a' })
      .returning()

    const [metric] = await db
      .insert(chatQueryMetrics)
      .values({
        workspaceId,
        sessionId,
        chatMessageId: message.id,
        question,
        questionEmbedding: fakeEmbedding(embeddingSeed),
        isFallback: true,
        cacheStatus: 'miss',
        queryClass: 'complex',
        topScore: null,
        latencyMs: 100,
      })
      .returning()

    return metric.id
  }

  it('labels the largest cluster and caches the result in Redis', async () => {
    const id1 = await seedFallbackMetric('why cant i log in with SSO', 1)
    const id2 = await seedFallbackMetric('SSO login is broken', 1)
    clusterer.cluster.mockReturnValue([[id1, id2]])
    generateTopicLabel.mockResolvedValue('SSO login troubleshooting')

    await processor.onGap({ data: { workspaceId } } as never)

    expect(generateTopicLabel).toHaveBeenCalledWith(
      expect.arrayContaining(['why cant i log in with SSO', 'SSO login is broken']),
    )
    expect(redis.set).toHaveBeenCalledWith(
      topicGapsRedisKey(workspaceId),
      JSON.stringify([{ label: 'SSO login troubleshooting', questionCount: 2, exampleQuestion: 'why cant i log in with SSO' }]),
      'EX',
      expect.any(Number),
    )

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('succeeded')
    expect(run.stats).toMatchObject({ candidateCount: 2, clustersFound: 1, gapsLabeled: 1 })
  })

  it('caches an empty array and skips labeling when there are no candidates', async () => {
    clusterer.cluster.mockReturnValue([])

    await processor.onGap({ data: { workspaceId } } as never)

    expect(redis.set).toHaveBeenCalledWith(topicGapsRedisKey(workspaceId), '[]', 'EX', expect.any(Number))
    expect(generateTopicLabel).not.toHaveBeenCalled()
  })

  it('records a failed run and rethrows when Redis write fails', async () => {
    clusterer.cluster.mockReturnValue([])
    redis.set.mockRejectedValue(new Error('redis down'))

    await expect(processor.onGap({ data: { workspaceId } } as never)).rejects.toThrow('redis down')

    const [run] = await db.select().from(backgroundRuns).where(eq(backgroundRuns.workspaceId, workspaceId))
    expect(run.status).toBe('failed')
    expect(run.lastError).toBe('redis down')
  })
})
