import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { Test } from '@nestjs/testing'
import { and, desc, eq, like } from 'drizzle-orm'
import {
  db,
  documents,
  knowledgeBases,
  pool,
  scrapeRuns,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { ConfigService } from '@nestjs/config'
import { ScrapeService } from './scrape.service'
import { assertPublicUrl } from '@repo/ai'

jest.mock('@repo/ai', () => ({
  assertPublicUrl: jest.fn(),
}))

async function cleanupFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(scrapeRuns).where(eq(scrapeRuns.workspaceId, membership.workspaceId))
      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(email: string, workspaceName: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: workspaceName, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [knowledgeBase] = await db
    .insert(knowledgeBases)
    .values({ workspaceId: workspace.id, name: `${workspaceName} KB` })
    .returning()

  return { user, workspace, knowledgeBase }
}

describe('ScrapeService', () => {
  let service: ScrapeService
  let queue: { add: jest.Mock; getJob: jest.Mock; on: jest.Mock }
  const prefix = `scrape-service-spec-${Date.now()}-`

  beforeAll(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      on: jest.fn(),
    }
    ;(assertPublicUrl as jest.Mock).mockResolvedValue(undefined)

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScrapeService,
        { provide: getQueueToken('scrape-queue'), useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('3') },
        },
      ],
    }).compile()

    service = moduleRef.get(ScrapeService)
  })

  afterEach(() => {
    jest.clearAllMocks()
    ;(assertPublicUrl as jest.Mock).mockResolvedValue(undefined)
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('startScrape creates queued run and enqueues job', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}queue@example.com`,
      'Scrape Queue WS',
    )

    const result = await service.startScrape(workspace.id, knowledgeBase.id, {
      url: 'https://example.com/docs',
      maxDepth: 2,
      maxPages: 10,
      includePrefixes: ['/docs'],
    })

    const [run] = await db
      .select()
      .from(scrapeRuns)
      .where(and(eq(scrapeRuns.id, result.runId), eq(scrapeRuns.workspaceId, workspace.id)))
      .limit(1)

    expect(result.status).toBe('queued')
    expect(run.status).toBe('queued')
    expect(run.maxPages).toBe(3)
    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        url: 'https://example.com/docs',
        maxDepth: 2,
        maxPages: 3,
        includePrefixes: ['/docs'],
      }),
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    )
  })

  it('derives seed-path scope when includePrefixes is omitted for a non-root path', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}derived-scope@example.com`,
      'Scrape Derived Scope WS',
    )

    await service.startScrape(workspace.id, knowledgeBase.id, {
      url: 'https://example.com/docs/article-a',
      maxDepth: 2,
      maxPages: 10,
    })

    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        includePrefixes: ['/docs/article-a'],
      }),
      expect.any(Object),
    )
  })

  it('keeps broad scope for root-path seeds when includePrefixes is omitted', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}root-scope@example.com`,
      'Scrape Root Scope WS',
    )

    await service.startScrape(workspace.id, knowledgeBase.id, {
      url: 'https://example.com/',
      maxDepth: 2,
      maxPages: 10,
    })

    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        includePrefixes: undefined,
      }),
      expect.any(Object),
    )
  })

  it('derives parent section scope for home-style seeds', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}home-scope@example.com`,
      'Scrape Home Scope WS',
    )

    await service.startScrape(workspace.id, knowledgeBase.id, {
      url: 'https://support.supremainc.com/en/support/home',
      maxDepth: 2,
      maxPages: 10,
    })

    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        includePrefixes: ['/en/support'],
      }),
      expect.any(Object),
    )
  })

  it('marks the run failed when enqueueing the scrape job fails', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}enqueue-fail@example.com`,
      'Scrape Enqueue Fail WS',
    )
    queue.add.mockRejectedValueOnce(new Error('Redis unavailable'))

    await expect(
      service.startScrape(workspace.id, knowledgeBase.id, {
        url: 'https://example.com/docs',
      }),
    ).rejects.toThrow('Redis unavailable')

    const [run] = await db
      .select()
      .from(scrapeRuns)
      .where(and(eq(scrapeRuns.workspaceId, workspace.id), eq(scrapeRuns.knowledgeBaseId, knowledgeBase.id)))
      .orderBy(desc(scrapeRuns.createdAt))
      .limit(1)

    expect(run.status).toBe('failed')
    expect(run.error).toContain('Redis unavailable')
  })

  it('reuses an existing in-flight run for the same workspace, knowledge base, and seed url', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}reuse@example.com`,
      'Scrape Reuse WS',
    )
    const [run] = await db
      .insert(scrapeRuns)
      .values({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: 'https://example.com/docs',
        status: 'queued',
        maxDepth: 2,
        maxPages: 10,
        queueJobId: 'scrape:existing-run',
        enqueuedAt: new Date(),
      })
      .returning()

    queue.getJob.mockResolvedValueOnce({ id: 'scrape:existing-run' })

    const result = await service.startScrape(workspace.id, knowledgeBase.id, {
      url: 'https://example.com/docs',
      maxDepth: 2,
      maxPages: 10,
    })

    expect(result).toEqual({ runId: run.id, status: 'queued', reusedExisting: true })
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('paginates scrape runs by createdAt desc with offset pages and defaults page size to 5', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}runs-page@example.com`,
      'Scrape Runs Page WS',
    )

    await db.insert(scrapeRuns).values(
      Array.from({ length: 6 }, (_, index) => ({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: `https://example.com/run-${index + 1}`,
        status: 'completed' as const,
        maxDepth: 1,
        maxPages: 10,
        createdAt: new Date(`2026-07-01T00:00:0${index + 1}.000Z`),
      })),
    )

    const firstPage = await service.listRuns(workspace.id, knowledgeBase.id, {})

    expect(firstPage.items.map((run) => run.seedUrl)).toEqual([
      'https://example.com/run-6',
      'https://example.com/run-5',
      'https://example.com/run-4',
      'https://example.com/run-3',
      'https://example.com/run-2',
    ])
    expect(firstPage.page).toBe(1)
    expect(firstPage.pageSize).toBe(5)
    expect(firstPage.total).toBe(6)
    expect(firstPage.totalPages).toBe(2)

    const secondPage = await service.listRuns(workspace.id, knowledgeBase.id, {
      page: '2',
      pageSize: '5',
    })

    expect(secondPage.items.map((run) => run.seedUrl)).toEqual(['https://example.com/run-1'])
    expect(secondPage.page).toBe(2)
  })

  it('searches scrape runs by seed URL and filters by status', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}runs-filter@example.com`,
      'Scrape Runs Filter WS',
    )

    await db.insert(scrapeRuns).values([
      {
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: 'https://example.com/docs',
        status: 'completed',
        maxDepth: 1,
        maxPages: 10,
      },
      {
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: 'https://example.com/support',
        status: 'failed',
        maxDepth: 1,
        maxPages: 10,
      },
    ])

    const searched = await service.listRuns(workspace.id, knowledgeBase.id, { q: 'docs' })
    expect(searched.items.map((run) => run.seedUrl)).toEqual(['https://example.com/docs'])
    expect(searched.total).toBe(1)

    const failed = await service.listRuns(workspace.id, knowledgeBase.id, { status: 'failed' })
    expect(failed.items.map((run) => run.seedUrl)).toEqual(['https://example.com/support'])
    expect(failed.total).toBe(1)
  })

  it('rejects internal seed urls before enqueueing', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}blocked@example.com`,
      'Scrape Blocked WS',
    )
    ;(assertPublicUrl as jest.Mock).mockRejectedValue(new Error('Blocked non-public URL'))

    await expect(
      service.startScrape(workspace.id, knowledgeBase.id, {
        url: 'http://169.254.169.254/latest/meta-data',
      }),
    ).rejects.toThrow('URL is not allowed')

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('rejects when quota reached', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}quota@example.com`,
      'Scrape Quota WS',
    )
    const [docA, docB, docC] = await db
      .insert(documents)
      .values([
        { workspaceId: workspace.id, knowledgeBaseId: knowledgeBase.id, title: 'a', status: 'pending' },
        { workspaceId: workspace.id, knowledgeBaseId: knowledgeBase.id, title: 'b', status: 'pending' },
        { workspaceId: workspace.id, knowledgeBaseId: knowledgeBase.id, title: 'c', status: 'pending' },
      ])
      .returning()

    expect([docA, docB, docC]).toHaveLength(3)

    await expect(
      service.startScrape(workspace.id, knowledgeBase.id, {
        url: 'https://example.com/docs',
      }),
    ).rejects.toThrow(ForbiddenException)
  })

  it('listRuns scoped to workspace and knowledge base', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine@example.com`, 'Scrape Mine WS')
    const other = await seedWorkspaceFixture(`${prefix}other@example.com`, 'Scrape Other WS')

    await db.insert(scrapeRuns).values({
      workspaceId: mine.workspace.id,
      knowledgeBaseId: mine.knowledgeBase.id,
      seedUrl: 'https://example.com/docs',
      status: 'queued',
      maxDepth: 1,
      maxPages: 5,
    })
    await db.insert(scrapeRuns).values({
      workspaceId: other.workspace.id,
      knowledgeBaseId: other.knowledgeBase.id,
      seedUrl: 'https://example.com/other',
      status: 'queued',
      maxDepth: 1,
      maxPages: 5,
    })

    const runs = await service.listRuns(mine.workspace.id, mine.knowledgeBase.id, {})

    expect(runs.items).toHaveLength(1)
    expect(runs.items[0]?.seedUrl).toBe('https://example.com/docs')
    expect(runs.total).toBe(1)
  })

  it('404s when kb not in workspace', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine404@example.com`, 'Scrape Mine 404 WS')
    const other = await seedWorkspaceFixture(`${prefix}other404@example.com`, 'Scrape Other 404 WS')

    await expect(
      service.listRuns(mine.workspace.id, other.knowledgeBase.id, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('reconciliation marks stale queued runs failed when the Bull job is missing', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}reconcile-stale@example.com`,
      'Scrape Reconcile Stale WS',
    )
    const staleQueuedAt = new Date(Date.now() - 3 * 60_000)
    const [run] = await db
      .insert(scrapeRuns)
      .values({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: 'https://example.com/docs',
        status: 'queued',
        maxDepth: 1,
        maxPages: 5,
        queueJobId: 'scrape:stale-run',
        enqueuedAt: staleQueuedAt,
      })
      .returning()

    queue.getJob.mockResolvedValueOnce(null)

    await service.reconcileRuns()

    const [updated] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id)).limit(1)
    expect(updated.status).toBe('failed')
    expect(updated.error).toContain('missing Bull job')
  })

  it('reconciliation leaves fresh and live runs untouched', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}reconcile-fresh@example.com`,
      'Scrape Reconcile Fresh WS',
    )
    const [freshRun, liveRun] = await db
      .insert(scrapeRuns)
      .values([
        {
          workspaceId: workspace.id,
          knowledgeBaseId: knowledgeBase.id,
          seedUrl: 'https://example.com/fresh',
          status: 'queued',
          maxDepth: 1,
          maxPages: 5,
          queueJobId: 'scrape:fresh-run',
          enqueuedAt: new Date(),
        },
        {
          workspaceId: workspace.id,
          knowledgeBaseId: knowledgeBase.id,
          seedUrl: 'https://example.com/live',
          status: 'running',
          maxDepth: 1,
          maxPages: 5,
          queueJobId: 'scrape:live-run',
          enqueuedAt: new Date(Date.now() - 31 * 60_000),
          startedAt: new Date(Date.now() - 31 * 60_000),
          lastProgressAt: new Date(),
        },
      ])
      .returning()

    queue.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === 'scrape:live-run') {
        return { id: jobId }
      }
      return null
    })

    await service.reconcileRuns()

    const runs = await db
      .select()
      .from(scrapeRuns)
      .where(and(eq(scrapeRuns.workspaceId, workspace.id), eq(scrapeRuns.knowledgeBaseId, knowledgeBase.id)))

    const fresh = runs.find((entry) => entry.id === freshRun.id)
    const live = runs.find((entry) => entry.id === liveRun.id)

    expect(fresh?.status).toBe('queued')
    expect(live?.status).toBe('running')
  })

  it('reconciliation marks stale running runs failed when no progress heartbeat remains', async () => {
    const { workspace, knowledgeBase } = await seedWorkspaceFixture(
      `${prefix}reconcile-idle@example.com`,
      'Scrape Reconcile Idle WS',
    )
    const staleRunningAt = new Date(Date.now() - 6 * 60_000)
    const [run] = await db
      .insert(scrapeRuns)
      .values({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        seedUrl: 'https://example.com/docs/idle',
        status: 'running',
        maxDepth: 1,
        maxPages: 5,
        queueJobId: 'scrape:idle-run',
        enqueuedAt: staleRunningAt,
        startedAt: staleRunningAt,
        lastProgressAt: staleRunningAt,
      })
      .returning()

    queue.getJob.mockResolvedValueOnce({ id: 'scrape:idle-run' })

    await service.reconcileRuns()

    const [updated] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id)).limit(1)
    expect(updated.status).toBe('failed')
    expect(updated.error).toContain('no crawl progress heartbeat')
  })
})
