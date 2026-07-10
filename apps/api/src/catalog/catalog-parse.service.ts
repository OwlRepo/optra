import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Job, Queue } from 'bull'
import { db, catalogs } from '@repo/db'
import { eq, or } from 'drizzle-orm'

const PENDING_CATALOG_STALE_MS = 2 * 60_000
const PROCESSING_CATALOG_STALE_MS = 30 * 60_000
const PARSE_JOB_TIMEOUT_MS = 5 * 60_000

interface StaleCatalogRow {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  queueJobId: string | null
  enqueuedAt: Date | null
  processingStartedAt: Date | null
  updatedAt: Date
  createdAt: Date
}

// Single-kind mirror of ProcurementParseService — catalogs has only one
// table (unlike purchaseOrders/invoices), so there's no kind branching.
@Injectable()
export class CatalogParseService implements OnModuleInit {
  private readonly logger = new Logger(CatalogParseService.name)

  constructor(@InjectQueue('catalog-parse-queue') private parseQueue: Queue) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcile().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile catalog-parse queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async queueDoc(id: string) {
    const jobId = this.getJobId(id)
    const enqueuedAt = new Date()
    const patch = {
      status: 'pending' as const,
      queueJobId: jobId,
      enqueuedAt,
      processingStartedAt: null,
      lastError: null,
      updatedAt: enqueuedAt,
    }

    await db.update(catalogs).set(patch).where(eq(catalogs.id, id))

    try {
      await this.parseQueue.add(
        { id },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: PARSE_JOB_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Catalog parse enqueue id=${id} jobId=${jobId}`)
      return { queued: true, id, jobId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailed(id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Catalog parse enqueue failed id=${id} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcile(now = new Date()) {
    const rows = await db
      .select()
      .from(catalogs)
      .where(or(eq(catalogs.status, 'pending'), eq(catalogs.status, 'processing')))
    await this.reconcileRows(rows, now)
  }

  private async reconcileRows(rows: StaleCatalogRow[], now: Date) {
    for (const row of rows) {
      const threshold = row.status === 'processing' ? PROCESSING_CATALOG_STALE_MS : PENDING_CATALOG_STALE_MS
      const referenceTime =
        row.status === 'processing'
          ? row.processingStartedAt ?? row.enqueuedAt ?? row.updatedAt ?? row.createdAt
          : row.enqueuedAt ?? row.updatedAt ?? row.createdAt

      if (!referenceTime || now.getTime() - referenceTime.getTime() < threshold) {
        continue
      }

      const job = row.queueJobId ? await this.parseQueue.getJob(row.queueJobId).catch(() => null) : null
      if (job) {
        continue
      }

      const lastError = `Queue reconciliation marked catalog as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`
      await this.markFailed(row.id, lastError, now)

      this.logger.warn(`Catalog parse reconciliation id=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed`)
    }
  }

  private async markFailed(id: string, lastError: string, updatedAt = new Date()) {
    await db.update(catalogs).set({ status: 'failed', lastError, updatedAt }).where(eq(catalogs.id, id))
  }

  private getJobId(id: string) {
    return `catalog-parse:${id}`
  }

  private registerQueueLogging() {
    this.parseQueue.on('active', (job: Job<{ id: string }>) => {
      this.logger.log(`Catalog parse active id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.parseQueue.on('completed', (job: Job<{ id: string }>) => {
      this.logger.log(`Catalog parse completed id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.parseQueue.on('failed', (job: Job<{ id: string }>, error: Error) => {
      this.logger.warn(`Catalog parse failed id=${job.data.id} jobId=${String(job.id)} error=${error.message}`)
    })
    this.parseQueue.on('stalled', (job: Job<{ id: string }>) => {
      this.logger.warn(`Catalog parse stalled id=${job.data.id} jobId=${String(job.id)}`)
    })
  }
}
