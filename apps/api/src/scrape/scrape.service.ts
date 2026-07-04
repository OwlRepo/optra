import { InjectQueue } from '@nestjs/bull'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Job, Queue } from 'bull'
import { and, count, desc, eq, ilike, or } from 'drizzle-orm'
import {
  buildOffsetResult,
  db,
  documents,
  knowledgeBases,
  resolveOffsetPage,
  scrapeRuns,
  type ScrapeRun,
} from '@repo/db'
import { assertPublicUrl } from '@repo/ai'
import { ListScrapeRunsQueryDto } from './dto/list-scrape-runs-query.dto'
import { ScrapeDto } from './dto/scrape.dto'

const QUEUED_SCRAPE_STALE_MS = 2 * 60_000
const RUNNING_SCRAPE_STALE_MS = 30 * 60_000
const RUNNING_SCRAPE_IDLE_MS = 5 * 60_000

type StartScrapeResult = {
  runId: string
  status: ScrapeRun['status']
  reusedExisting?: boolean
}

@Injectable()
export class ScrapeService implements OnModuleInit {
  private readonly logger = new Logger(ScrapeService.name)

  constructor(
    @InjectQueue('scrape-queue') private readonly scrapeQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcileRuns().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile scrape queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async startScrape(workspaceId: string, kbId: string, dto: ScrapeDto): Promise<StartScrapeResult> {
    await this.assertKbInWorkspace(workspaceId, kbId)
    await Promise.resolve(assertPublicUrl(dto.url)).catch(() => {
      throw new BadRequestException('URL is not allowed')
    })

    const quotaRemaining = await this.quotaRemaining(workspaceId)
    if (quotaRemaining <= 0) {
      throw new ForbiddenException('Workspace document quota reached')
    }

    const maxDepth = dto.maxDepth ?? 3
    const maxPages = Math.min(dto.maxPages ?? 500, quotaRemaining)
    const includePrefixes = dto.includePrefixes ?? this.deriveDefaultIncludePrefixes(dto.url)
    const now = new Date()
    const existingRun = await this.findInFlightRun(workspaceId, kbId, dto.url)

    if (existingRun) {
      const hasLiveJob = existingRun.queueJobId ? await this.scrapeQueue.getJob(existingRun.queueJobId).catch(() => null) : null
      if (hasLiveJob || !this.isRunStale(existingRun, now)) {
        this.logger.log(`Scrape reuse runId=${existingRun.id} jobId=${existingRun.queueJobId ?? '(none)'} seedUrl=${dto.url}`)
        return { runId: existingRun.id, status: existingRun.status, reusedExisting: true }
      }

      await this.failRun(
        existingRun.id,
        `Queue reconciliation marked scrape run as failed: missing Bull job ${existingRun.queueJobId ?? '(none)'} after ${existingRun.status} grace period`,
      )
    }

    const enqueuedAt = new Date()

    const [run] = await db
      .insert(scrapeRuns)
      .values({
        workspaceId,
        knowledgeBaseId: kbId,
        seedUrl: dto.url,
        status: 'queued',
        maxDepth,
        maxPages,
      })
      .returning()

    const jobId = this.getJobId(run.id)
    await db.update(scrapeRuns).set({ queueJobId: jobId, enqueuedAt }).where(eq(scrapeRuns.id, run.id))

    try {
      await this.scrapeQueue.add(
        {
          runId: run.id,
          workspaceId,
          knowledgeBaseId: kbId,
          url: dto.url,
          maxDepth,
          maxPages,
          includePrefixes,
        },
        {
          jobId,
          attempts: 1,
          timeout: RUNNING_SCRAPE_IDLE_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Scrape enqueue runId=${run.id} jobId=${jobId} seedUrl=${dto.url}`)
      return { runId: run.id, status: run.status }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.failRun(run.id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Scrape enqueue failed runId=${run.id} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async listRuns(
    workspaceId: string,
    kbId: string,
    query: Pick<ListScrapeRunsQueryDto, 'page' | 'pageSize' | 'q' | 'status'>,
  ) {
    await this.assertKbInWorkspace(workspaceId, kbId)
    const { page, pageSize, offset } = resolveOffsetPage(query.page, query.pageSize, { pageSize: 5 })

    const filters = [
      eq(scrapeRuns.workspaceId, workspaceId),
      eq(scrapeRuns.knowledgeBaseId, kbId),
    ]
    if (query.status) {
      filters.push(eq(scrapeRuns.status, query.status))
    }
    const search = query.q?.trim()
    if (search) {
      filters.push(ilike(scrapeRuns.seedUrl, `%${search}%`))
    }
    const where = and(...filters)

    const [{ value: total }] = await db.select({ value: count() }).from(scrapeRuns).where(where)

    const items = await db
      .select()
      .from(scrapeRuns)
      .where(where)
      .orderBy(desc(scrapeRuns.createdAt), desc(scrapeRuns.id))
      .limit(pageSize)
      .offset(offset)

    return buildOffsetResult(items, Number(total), page, pageSize)
  }

  async quotaRemaining(workspaceId: string) {
    const cap = Number(this.config.get('MAX_DOCS_PER_WORKSPACE') ?? 5000)
    const [result] = await db
      .select({ count: count(documents.id) })
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId))

    return cap - Number(result?.count ?? 0)
  }

  async reconcileRuns(now = new Date()) {
    const rows = await db
      .select()
      .from(scrapeRuns)
      .where(or(eq(scrapeRuns.status, 'queued'), eq(scrapeRuns.status, 'running')))

    for (const row of rows) {
      if (row.status === 'running' && this.isRunIdle(row, now)) {
        const idleForMs = now.getTime() - (row.lastProgressAt ?? row.startedAt ?? row.enqueuedAt ?? row.createdAt).getTime()
        const message = `Queue reconciliation marked scrape run as failed: no crawl progress heartbeat for ${idleForMs}ms`
        await this.failRun(row.id, message)
        this.logger.warn(`Scrape reconciliation runId=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed reason=idle`)
        continue
      }

      if (this.isRunStale(row, now)) {
        const job = row.queueJobId ? await this.scrapeQueue.getJob(row.queueJobId).catch(() => null) : null
        if (job) {
          continue
        }

        const message = `Queue reconciliation marked scrape run as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`
        await this.failRun(row.id, message)
        this.logger.warn(`Scrape reconciliation runId=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed`)
      }
    }
  }

  private async assertKbInWorkspace(workspaceId: string, kbId: string) {
    const [knowledgeBase] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1)

    if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
      throw new NotFoundException('Knowledge base not found')
    }

    return knowledgeBase
  }

  private async findInFlightRun(workspaceId: string, kbId: string, seedUrl: string) {
    const [run] = await db
      .select()
      .from(scrapeRuns)
      .where(
        and(
          eq(scrapeRuns.workspaceId, workspaceId),
          eq(scrapeRuns.knowledgeBaseId, kbId),
          eq(scrapeRuns.seedUrl, seedUrl),
          or(eq(scrapeRuns.status, 'queued'), eq(scrapeRuns.status, 'running')),
        ),
      )
      .orderBy(desc(scrapeRuns.createdAt))
      .limit(1)

    return run
  }

  private async failRun(runId: string, error: string) {
    await db
      .update(scrapeRuns)
      .set({
        status: 'failed',
        error,
        finishedAt: new Date(),
      })
      .where(and(eq(scrapeRuns.id, runId), or(eq(scrapeRuns.status, 'queued'), eq(scrapeRuns.status, 'running'))))
  }

  private getJobId(runId: string) {
    return `scrape:${runId}`
  }

  private isRunStale(
    run: typeof scrapeRuns.$inferSelect,
    now: Date,
  ) {
    const threshold = run.status === 'running' ? RUNNING_SCRAPE_STALE_MS : QUEUED_SCRAPE_STALE_MS
    const referenceTime =
      run.status === 'running'
        ? run.startedAt ?? run.enqueuedAt ?? run.createdAt
        : run.enqueuedAt ?? run.createdAt

    return Boolean(referenceTime) && now.getTime() - referenceTime.getTime() >= threshold
  }

  private isRunIdle(run: typeof scrapeRuns.$inferSelect, now: Date) {
    if (run.status !== 'running') {
      return false
    }

    const heartbeatAt = run.lastProgressAt ?? run.startedAt ?? run.enqueuedAt ?? run.createdAt
    return Boolean(heartbeatAt) && now.getTime() - heartbeatAt.getTime() >= RUNNING_SCRAPE_IDLE_MS
  }

  private deriveDefaultIncludePrefixes(seedUrl: string) {
    const { pathname } = new URL(seedUrl)
    const normalizedPath = pathname.replace(/\/+$/, '') || '/'

    if (normalizedPath === '/') {
      return undefined
    }

    if (normalizedPath.endsWith('/home')) {
      const parentPath = normalizedPath.slice(0, -'/home'.length) || '/'
      return parentPath === '/' ? undefined : [parentPath]
    }

    return [normalizedPath]
  }

  private registerQueueLogging() {
    this.scrapeQueue.on('active', (job: Job<{ runId: string }>) => {
      this.logger.log(`Scrape active runId=${job.data.runId} jobId=${String(job.id)}`)
    })
    this.scrapeQueue.on('completed', (job: Job<{ runId: string }>) => {
      this.logger.log(`Scrape completed runId=${job.data.runId} jobId=${String(job.id)}`)
    })
    this.scrapeQueue.on('failed', (job: Job<{ runId: string }>, error: Error) => {
      this.logger.warn(`Scrape failed runId=${job.data.runId} jobId=${String(job.id)} error=${error.message}`)
      void this.failRun(job.data.runId, `Queue worker failed: ${error.message}`)
    })
    this.scrapeQueue.on('stalled', (job: Job<{ runId: string }>) => {
      this.logger.warn(`Scrape stalled runId=${job.data.runId} jobId=${String(job.id)}`)
    })
  }
}
