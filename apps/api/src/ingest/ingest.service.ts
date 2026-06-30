import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Job, Queue } from 'bull'
import { db, documents } from '@repo/db'
import { eq, or } from 'drizzle-orm'

const PENDING_DOCUMENT_STALE_MS = 2 * 60_000
const PROCESSING_DOCUMENT_STALE_MS = 30 * 60_000
const INGEST_JOB_TIMEOUT_MS = 5 * 60_000

@Injectable()
export class IngestService implements OnModuleInit {
  private readonly logger = new Logger(IngestService.name)

  constructor(
    @InjectQueue('ingest-queue') private ingestQueue: Queue,
  ) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcileDocuments().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile ingest queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async queueDocument(documentId: string) {
    const jobId = this.getJobId(documentId)
    const enqueuedAt = new Date()

    await db
      .update(documents)
      .set({
        status: 'pending',
        queueJobId: jobId,
        enqueuedAt,
        processingStartedAt: null,
        lastError: null,
        updatedAt: enqueuedAt,
      })
      .where(eq(documents.id, documentId))

    try {
      await this.ingestQueue.add(
        { documentId },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: INGEST_JOB_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Ingest enqueue documentId=${documentId} jobId=${jobId}`)
      return { queued: true, documentId, jobId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(documents)
        .set({
          status: 'failed',
          lastError: `Queue enqueue failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId))

      this.logger.error(`Ingest enqueue failed documentId=${documentId} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcileDocuments(now = new Date()) {
    const rows = await db
      .select()
      .from(documents)
      .where(or(eq(documents.status, 'pending'), eq(documents.status, 'processing')))

    for (const row of rows) {
      const threshold = row.status === 'processing' ? PROCESSING_DOCUMENT_STALE_MS : PENDING_DOCUMENT_STALE_MS
      const referenceTime =
        row.status === 'processing'
          ? row.processingStartedAt ?? row.enqueuedAt ?? row.updatedAt ?? row.createdAt
          : row.enqueuedAt ?? row.updatedAt ?? row.createdAt

      if (!referenceTime || now.getTime() - referenceTime.getTime() < threshold) {
        continue
      }

      const job = row.queueJobId ? await this.ingestQueue.getJob(row.queueJobId).catch(() => null) : null
      if (job) {
        continue
      }

      const lastError = `Queue reconciliation marked document as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`
      await db
        .update(documents)
        .set({
          status: 'failed',
          lastError,
          updatedAt: now,
        })
        .where(eq(documents.id, row.id))

      this.logger.warn(`Ingest reconciliation documentId=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed`)
    }
  }

  private getJobId(documentId: string) {
    return `ingest:${documentId}`
  }

  private registerQueueLogging() {
    this.ingestQueue.on('active', (job: Job<{ documentId: string }>) => {
      this.logger.log(`Ingest active documentId=${job.data.documentId} jobId=${String(job.id)}`)
    })
    this.ingestQueue.on('completed', (job: Job<{ documentId: string }>) => {
      this.logger.log(`Ingest completed documentId=${job.data.documentId} jobId=${String(job.id)}`)
    })
    this.ingestQueue.on('failed', (job: Job<{ documentId: string }>, error: Error) => {
      this.logger.warn(`Ingest failed documentId=${job.data.documentId} jobId=${String(job.id)} error=${error.message}`)
    })
    this.ingestQueue.on('stalled', (job: Job<{ documentId: string }>) => {
      this.logger.warn(`Ingest stalled documentId=${job.data.documentId} jobId=${String(job.id)}`)
    })
  }
}
