import { InjectQueue } from '@nestjs/bull'
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { Job, Queue } from 'bull'
import { and, eq, or } from 'drizzle-orm'
import { assertPublicUrl } from '@repo/ai'
import { Catalog, catalogs, db, vendors } from '@repo/db'
import { ScrapeCatalogDto } from './dto/scrape-catalog.dto'

const QUEUED_CATALOG_SCRAPE_STALE_MS = 2 * 60_000
const RUNNING_CATALOG_SCRAPE_STALE_MS = 30 * 60_000
const RUNNING_CATALOG_SCRAPE_IDLE_MS = 5 * 60_000

type ScrapeJobData = { id: string; workspaceId: string; vendorId: string; seedUrl: string; maxDepth: number; maxPages: number }

// Mirrors ScrapeService's queue lifecycle (enqueue, reconcile, stale/idle
// thresholds) over the catalogs table instead of scrapeRuns — catalogs
// already carries the same progress columns (pagesFound/Succeeded/Failed,
// lastProgressAt) since Phase 1's schema was designed for both source kinds.
@Injectable()
export class CatalogScrapeService implements OnModuleInit {
  private readonly logger = new Logger(CatalogScrapeService.name)

  constructor(@InjectQueue('catalog-scrape-queue') private readonly scrapeQueue: Queue) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcile().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile catalog-scrape queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async startScrape(workspaceId: string, vendorId: string, dto: ScrapeCatalogDto) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)
    await Promise.resolve(assertPublicUrl(dto.seedUrl)).catch(() => {
      throw new BadRequestException('URL is not allowed')
    })

    const [catalog] = await db
      .insert(catalogs)
      .values({
        workspaceId,
        vendorId,
        name: dto.seedUrl,
        sourceKind: 'scrape',
        seedUrl: dto.seedUrl,
        status: 'pending',
      })
      .returning()

    const jobId = this.getJobId(catalog.id)
    const enqueuedAt = new Date()
    await db.update(catalogs).set({ queueJobId: jobId, enqueuedAt }).where(eq(catalogs.id, catalog.id))

    try {
      await this.scrapeQueue.add(
        {
          id: catalog.id,
          workspaceId,
          vendorId,
          seedUrl: dto.seedUrl,
          maxDepth: dto.maxDepth ?? 3,
          maxPages: dto.maxPages ?? 500,
        },
        {
          jobId,
          attempts: 1,
          timeout: RUNNING_CATALOG_SCRAPE_IDLE_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Catalog scrape enqueue id=${catalog.id} jobId=${jobId} seedUrl=${dto.seedUrl}`)
      return { id: catalog.id, status: catalog.status }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.failCatalog(catalog.id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Catalog scrape enqueue failed id=${catalog.id} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcile(now = new Date()) {
    const rows = await db
      .select()
      .from(catalogs)
      .where(
        and(eq(catalogs.sourceKind, 'scrape'), or(eq(catalogs.status, 'pending'), eq(catalogs.status, 'processing'))),
      )

    for (const row of rows) {
      if (row.status === 'processing' && this.isIdle(row, now)) {
        const heartbeatAt = row.lastProgressAt ?? row.processingStartedAt ?? row.enqueuedAt ?? row.createdAt
        const idleForMs = now.getTime() - heartbeatAt.getTime()
        await this.failCatalog(
          row.id,
          `Queue reconciliation marked catalog scrape as failed: no crawl progress heartbeat for ${idleForMs}ms`,
        )
        this.logger.warn(
          `Catalog scrape reconciliation id=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed reason=idle`,
        )
        continue
      }

      if (this.isStale(row, now)) {
        const job = row.queueJobId ? await this.scrapeQueue.getJob(row.queueJobId).catch(() => null) : null
        if (job) {
          continue
        }

        await this.failCatalog(
          row.id,
          `Queue reconciliation marked catalog scrape as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`,
        )
        this.logger.warn(`Catalog scrape reconciliation id=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed`)
      }
    }
  }

  private async assertVendorInWorkspace(workspaceId: string, vendorId: string) {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))

    if (!vendor) {
      throw new NotFoundException('Vendor not found')
    }

    return vendor
  }

  private async failCatalog(id: string, lastError: string) {
    await db
      .update(catalogs)
      .set({ status: 'failed', lastError, updatedAt: new Date() })
      .where(and(eq(catalogs.id, id), or(eq(catalogs.status, 'pending'), eq(catalogs.status, 'processing'))))
  }

  private getJobId(id: string) {
    return `catalog-scrape:${id}`
  }

  private isStale(row: Catalog, now: Date) {
    const threshold = row.status === 'processing' ? RUNNING_CATALOG_SCRAPE_STALE_MS : QUEUED_CATALOG_SCRAPE_STALE_MS
    const referenceTime =
      row.status === 'processing' ? row.processingStartedAt ?? row.enqueuedAt ?? row.createdAt : row.enqueuedAt ?? row.createdAt

    return Boolean(referenceTime) && now.getTime() - referenceTime.getTime() >= threshold
  }

  private isIdle(row: Catalog, now: Date) {
    if (row.status !== 'processing') {
      return false
    }

    const heartbeatAt = row.lastProgressAt ?? row.processingStartedAt ?? row.enqueuedAt ?? row.createdAt
    return Boolean(heartbeatAt) && now.getTime() - heartbeatAt.getTime() >= RUNNING_CATALOG_SCRAPE_IDLE_MS
  }

  private registerQueueLogging() {
    this.scrapeQueue.on('active', (job: Job<ScrapeJobData>) => {
      this.logger.log(`Catalog scrape active id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.scrapeQueue.on('completed', (job: Job<ScrapeJobData>) => {
      this.logger.log(`Catalog scrape completed id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.scrapeQueue.on('failed', (job: Job<ScrapeJobData>, error: Error) => {
      this.logger.warn(`Catalog scrape failed id=${job.data.id} jobId=${String(job.id)} error=${error.message}`)
    })
    this.scrapeQueue.on('stalled', (job: Job<ScrapeJobData>) => {
      this.logger.warn(`Catalog scrape stalled id=${job.data.id} jobId=${String(job.id)}`)
    })
  }
}
