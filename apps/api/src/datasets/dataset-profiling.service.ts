import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Job, Queue } from 'bull'
import { datasets, db } from '@repo/db'
import { eq, or } from 'drizzle-orm'

const PENDING_DATASET_STALE_MS = 2 * 60_000
const PROCESSING_DATASET_STALE_MS = 30 * 60_000
const PROFILING_JOB_TIMEOUT_MS = 5 * 60_000

@Injectable()
export class DatasetProfilingService implements OnModuleInit {
  private readonly logger = new Logger(DatasetProfilingService.name)

  constructor(@InjectQueue('dataset-profiling-queue') private profilingQueue: Queue) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcileDatasets().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile dataset-profiling queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })
  }

  async queueDataset(datasetId: string) {
    const jobId = this.getJobId(datasetId)
    const enqueuedAt = new Date()

    await db
      .update(datasets)
      .set({
        status: 'pending',
        queueJobId: jobId,
        enqueuedAt,
        processingStartedAt: null,
        lastError: null,
        updatedAt: enqueuedAt,
      })
      .where(eq(datasets.id, datasetId))

    try {
      await this.profilingQueue.add(
        { datasetId },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: PROFILING_JOB_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Dataset profiling enqueue datasetId=${datasetId} jobId=${jobId}`)
      return { queued: true, datasetId, jobId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(datasets)
        .set({
          status: 'failed',
          lastError: `Queue enqueue failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(datasets.id, datasetId))

      this.logger.error(`Dataset profiling enqueue failed datasetId=${datasetId} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcileDatasets(now = new Date()) {
    const rows = await db
      .select()
      .from(datasets)
      .where(or(eq(datasets.status, 'pending'), eq(datasets.status, 'processing')))

    for (const row of rows) {
      const threshold =
        row.status === 'processing' ? PROCESSING_DATASET_STALE_MS : PENDING_DATASET_STALE_MS
      const referenceTime =
        row.status === 'processing'
          ? row.processingStartedAt ?? row.enqueuedAt ?? row.updatedAt ?? row.createdAt
          : row.enqueuedAt ?? row.updatedAt ?? row.createdAt

      if (!referenceTime || now.getTime() - referenceTime.getTime() < threshold) {
        continue
      }

      const job = row.queueJobId ? await this.profilingQueue.getJob(row.queueJobId).catch(() => null) : null
      if (job) {
        continue
      }

      const lastError = `Queue reconciliation marked dataset as failed: missing Bull job ${row.queueJobId ?? '(none)'} after ${row.status} grace period`
      await db
        .update(datasets)
        .set({ status: 'failed', lastError, updatedAt: now })
        .where(eq(datasets.id, row.id))

      this.logger.warn(`Dataset profiling reconciliation datasetId=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed`)
    }
  }

  private getJobId(datasetId: string) {
    return `dataset-profiling:${datasetId}`
  }

  private registerQueueLogging() {
    this.profilingQueue.on('active', (job: Job<{ datasetId: string }>) => {
      this.logger.log(`Dataset profiling active datasetId=${job.data.datasetId} jobId=${String(job.id)}`)
    })
    this.profilingQueue.on('completed', (job: Job<{ datasetId: string }>) => {
      this.logger.log(`Dataset profiling completed datasetId=${job.data.datasetId} jobId=${String(job.id)}`)
    })
    this.profilingQueue.on('failed', (job: Job<{ datasetId: string }>, error: Error) => {
      this.logger.warn(
        `Dataset profiling failed datasetId=${job.data.datasetId} jobId=${String(job.id)} error=${error.message}`,
      )
    })
    this.profilingQueue.on('stalled', (job: Job<{ datasetId: string }>) => {
      this.logger.warn(`Dataset profiling stalled datasetId=${job.data.datasetId} jobId=${String(job.id)}`)
    })
  }
}
