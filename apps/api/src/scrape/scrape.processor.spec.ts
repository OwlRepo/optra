import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { eq, like } from 'drizzle-orm'
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
import { ScrapeProcessor } from './scrape.processor'
import { StorageService } from '../storage/storage.service'
import { IngestService } from '../ingest/ingest.service'

const mockCrawlSite = jest.fn()

jest.mock('@repo/ai', () => ({
  crawlSite: (...args: unknown[]) => mockCrawlSite(...args),
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

async function seedRun(emailPrefix: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${emailPrefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Scrape Processor WS ${Date.now()}`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [knowledgeBase] = await db
    .insert(knowledgeBases)
    .values({ workspaceId: workspace.id, name: `KB ${Date.now()}` })
    .returning()
  const [run] = await db
    .insert(scrapeRuns)
    .values({
      workspaceId: workspace.id,
      knowledgeBaseId: knowledgeBase.id,
      seedUrl: 'https://example.com/docs',
      status: 'queued',
      maxDepth: 2,
      maxPages: 10,
    })
    .returning()

  return { workspace, knowledgeBase, run }
}

describe('ScrapeProcessor', () => {
  let processor: ScrapeProcessor
  let storage: { save: jest.Mock }
  let ingest: { queueDocument: jest.Mock }
  const prefix = `scrape-processor-spec-${Date.now()}-`

  beforeAll(async () => {
    storage = { save: jest.fn().mockResolvedValue(undefined) }
    ingest = { queueDocument: jest.fn().mockResolvedValue({ queued: true }) }

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScrapeProcessor,
        { provide: StorageService, useValue: storage },
        { provide: IngestService, useValue: ingest },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('CrawlerTest/1.0') },
        },
      ],
    }).compile()

    processor = moduleRef.get(ScrapeProcessor)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('stores pages, upserts documents, queues ingest, completes run', async () => {
    const { workspace, knowledgeBase, run } = await seedRun(prefix)
    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const pages = [
        { url: 'https://example.com/docs/a', title: 'Page A', content: 'A body' },
        { url: 'https://example.com/docs/b', title: 'Page B', content: 'B body' },
      ]

      for (const [index, page] of pages.entries()) {
        await options?.onPage?.(page, {
          pagesFound: index + 1,
          pagesVisited: index + 1,
          pagesQueued: pages.length,
          maxPages: 10,
        })
      }

      return pages
    })

    await processor.handleScrape({
      id: 'job-1',
      data: {
        runId: run.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        url: run.seedUrl,
        maxDepth: 2,
        maxPages: 10,
      },
    } as any)

    const savedDocs = await db.select().from(documents).where(eq(documents.workspaceId, workspace.id))
    const [updatedRun] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id)).limit(1)

    expect(savedDocs).toHaveLength(2)
    expect(savedDocs.map((doc) => doc.sourceUrl).sort()).toEqual([
      'https://example.com/docs/a',
      'https://example.com/docs/b',
    ])
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(ingest.queueDocument).toHaveBeenCalledTimes(2)
    expect(updatedRun.status).toBe('completed')
    expect(updatedRun.pagesFound).toBe(2)
    expect(updatedRun.pagesSucceeded).toBe(2)
    expect(updatedRun.pagesFailed).toBe(0)
  })

  it('updates live crawl counters and heartbeat while pages stream in', async () => {
    const { workspace, knowledgeBase, run } = await seedRun(prefix)
    const progressSnapshots: Array<{ pagesFound: number; pagesSucceeded: number; pagesFailed: number; lastProgressAt: Date | null }> = []

    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const firstPage = { url: 'https://example.com/docs/a', title: 'Page A', content: 'A body' }
      const secondPage = { url: 'https://example.com/docs/b', title: 'Page B', content: 'B body' }

      await options?.onPage?.(firstPage, {
        pagesFound: 1,
        pagesVisited: 1,
        pagesQueued: 2,
        maxPages: 10,
      })
      progressSnapshots.push(
        await db
          .select({
            pagesFound: scrapeRuns.pagesFound,
            pagesSucceeded: scrapeRuns.pagesSucceeded,
            pagesFailed: scrapeRuns.pagesFailed,
            lastProgressAt: scrapeRuns.lastProgressAt,
          })
          .from(scrapeRuns)
          .where(eq(scrapeRuns.id, run.id))
          .then((rows) => rows[0]!),
      )

      storage.save.mockRejectedValueOnce(new Error('save failed'))
      await options?.onPage?.(secondPage, {
        pagesFound: 2,
        pagesVisited: 2,
        pagesQueued: 2,
        maxPages: 10,
      })
      progressSnapshots.push(
        await db
          .select({
            pagesFound: scrapeRuns.pagesFound,
            pagesSucceeded: scrapeRuns.pagesSucceeded,
            pagesFailed: scrapeRuns.pagesFailed,
            lastProgressAt: scrapeRuns.lastProgressAt,
          })
          .from(scrapeRuns)
          .where(eq(scrapeRuns.id, run.id))
          .then((rows) => rows[0]!),
      )

      return [firstPage, secondPage]
    })

    await processor.handleScrape({
      id: 'job-live',
      data: {
        runId: run.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        url: run.seedUrl,
        maxDepth: 2,
        maxPages: 10,
      },
    } as any)

    expect(progressSnapshots).toHaveLength(2)
    expect(progressSnapshots[0]).toMatchObject({ pagesFound: 1, pagesSucceeded: 1, pagesFailed: 0 })
    expect(progressSnapshots[1]).toMatchObject({ pagesFound: 2, pagesSucceeded: 1, pagesFailed: 1 })
    expect(progressSnapshots[0]?.lastProgressAt).not.toBeNull()
    expect(progressSnapshots[1]?.lastProgressAt).not.toBeNull()
  })

  it('updates existing sourceUrl instead of duplicating and counts per-page failures', async () => {
    const { workspace, knowledgeBase, run } = await seedRun(prefix)
    const [existing] = await db
      .insert(documents)
      .values({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        title: 'Old Title',
        sourceUrl: 'https://example.com/docs/a',
        storageKey: 'old.txt',
        status: 'done',
      })
      .returning()

    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const pages = [
        { url: 'https://example.com/docs/a', title: 'New Title', content: 'A body' },
        { url: 'https://example.com/docs/b', title: 'Page B', content: 'B body' },
      ]

      for (const [index, page] of pages.entries()) {
        await options?.onPage?.(page, {
          pagesFound: index + 1,
          pagesVisited: index + 1,
          pagesQueued: pages.length,
          maxPages: 10,
        })
      }

      return pages
    })
    storage.save
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('save failed'))

    await processor.handleScrape({
      id: 'job-2',
      data: {
        runId: run.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        url: run.seedUrl,
        maxDepth: 2,
        maxPages: 10,
      },
    } as any)

    const savedDocs = await db.select().from(documents).where(eq(documents.workspaceId, workspace.id))
    const [updatedExisting] = await db.select().from(documents).where(eq(documents.id, existing.id)).limit(1)
    const [updatedRun] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id)).limit(1)

    expect(savedDocs).toHaveLength(1)
    expect(updatedExisting.title).toBe('New Title')
    expect(updatedExisting.status).toBe('pending')
    expect(ingest.queueDocument).toHaveBeenCalledTimes(1)
    expect(updatedRun.status).toBe('completed')
    expect(updatedRun.pagesSucceeded).toBe(1)
    expect(updatedRun.pagesFailed).toBe(1)
  })

  it('marks run failed when crawlSite throws', async () => {
    const { workspace, knowledgeBase, run } = await seedRun(prefix)
    mockCrawlSite.mockRejectedValue(new Error('crawl exploded'))

    await processor.handleScrape({
      id: 'job-3',
      data: {
        runId: run.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        url: run.seedUrl,
        maxDepth: 2,
        maxPages: 10,
      },
    } as any)

    const [updatedRun] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id)).limit(1)

    expect(updatedRun.status).toBe('failed')
    expect(updatedRun.error).toContain('crawl exploded')
    expect(updatedRun.finishedAt).not.toBeNull()
    expect(storage.save).not.toHaveBeenCalled()
    expect(ingest.queueDocument).not.toHaveBeenCalled()
  })
})
