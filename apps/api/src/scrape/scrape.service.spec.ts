import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
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
  let queue: { add: jest.Mock }
  const prefix = `scrape-service-spec-${Date.now()}-`

  beforeAll(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) }

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

    const runs = await service.listRuns(mine.workspace.id, mine.knowledgeBase.id)

    expect(runs).toHaveLength(1)
    expect(runs[0]?.seedUrl).toBe('https://example.com/docs')
  })

  it('404s when kb not in workspace', async () => {
    const mine = await seedWorkspaceFixture(`${prefix}mine404@example.com`, 'Scrape Mine 404 WS')
    const other = await seedWorkspaceFixture(`${prefix}other404@example.com`, 'Scrape Other 404 WS')

    await expect(
      service.listRuns(mine.workspace.id, other.knowledgeBase.id),
    ).rejects.toThrow(NotFoundException)
  })
})
