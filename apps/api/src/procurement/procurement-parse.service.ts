import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Job, Queue } from 'bull'
import { db, invoices, purchaseOrders } from '@repo/db'
import { eq, or } from 'drizzle-orm'

const PENDING_DOC_STALE_MS = 2 * 60_000
const PROCESSING_DOC_STALE_MS = 30 * 60_000
const PARSE_JOB_TIMEOUT_MS = 5 * 60_000
const RECONCILE_EVERY_MS = 5 * 60_000
// A document whose job keeps vanishing is re-enqueued at most this many times
// before reconciliation gives up and marks it failed (no infinite requeue).
const MAX_RECONCILE_REQUEUES = 2
export const RECONCILE_JOB_NAME = 'reconcile'

export type ProcurementDocKind = 'purchase_order' | 'invoice'

interface StaleDocRow {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  queueJobId: string | null
  enqueuedAt: Date | null
  processingStartedAt: Date | null
  updatedAt: Date
  createdAt: Date
}

// Two document kinds share one queue/processor (procurement-parse-queue),
// unlike DatasetProfilingService which owns a single entity type — each
// write branches explicitly on `kind` rather than going through a generic
// table-lookup helper, since purchaseOrders/invoices are distinct Drizzle
// table objects and a union-typed `db.update(table)` call doesn't resolve
// cleanly against Drizzle's per-table overloads.
@Injectable()
export class ProcurementParseService implements OnModuleInit {
  private readonly logger = new Logger(ProcurementParseService.name)

  constructor(@InjectQueue('procurement-parse-queue') private parseQueue: Queue) {}

  async onModuleInit() {
    this.registerQueueLogging()
    await this.reconcile().catch((error: unknown) => {
      this.logger.error(
        `Failed to reconcile procurement-parse queue: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    })

    // Boot-only reconciliation left a stuck document stuck until the next
    // restart. Same repeatable-job substrate as the insights ticks: re-adding
    // the same repeatable jobId on every boot is a Bull no-op.
    await this.parseQueue
      .add(
        RECONCILE_JOB_NAME,
        {},
        { jobId: 'procurement-parse-reconcile', repeat: { every: RECONCILE_EVERY_MS }, removeOnComplete: true },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to schedule procurement-parse reconciliation: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  // `requeue` > 0 gives the job a fresh id: Bull's addJob silently returns the
  // existing job for an id it still holds (removeOnFail keeps failed jobs), so
  // re-adding under the original id would never run.
  async queueDoc(kind: ProcurementDocKind, id: string, requeue = 0) {
    const jobId = this.getJobId(kind, id, requeue)
    const enqueuedAt = new Date()
    const patch = {
      status: 'pending' as const,
      queueJobId: jobId,
      enqueuedAt,
      processingStartedAt: null,
      lastError: null,
      updatedAt: enqueuedAt,
    }

    if (kind === 'purchase_order') {
      await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id))
    } else {
      await db.update(invoices).set(patch).where(eq(invoices.id, id))
    }

    try {
      await this.parseQueue.add(
        { kind, id },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: PARSE_JOB_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: false,
        },
      )
      this.logger.log(`Procurement parse enqueue kind=${kind} id=${id} jobId=${jobId}`)
      return { queued: true, kind, id, jobId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailed(kind, id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Procurement parse enqueue failed kind=${kind} id=${id} jobId=${jobId}: ${message}`)
      throw error
    }
  }

  async reconcile(now = new Date()) {
    const poRows = await db
      .select()
      .from(purchaseOrders)
      .where(or(eq(purchaseOrders.status, 'pending'), eq(purchaseOrders.status, 'processing')))
    await this.reconcileRows('purchase_order', poRows, now)

    const invoiceRows = await db
      .select()
      .from(invoices)
      .where(or(eq(invoices.status, 'pending'), eq(invoices.status, 'processing')))
    await this.reconcileRows('invoice', invoiceRows, now)
  }

  private async reconcileRows(kind: ProcurementDocKind, rows: StaleDocRow[], now: Date) {
    for (const row of rows) {
      const threshold = row.status === 'processing' ? PROCESSING_DOC_STALE_MS : PENDING_DOC_STALE_MS
      const referenceTime =
        row.status === 'processing'
          ? row.processingStartedAt ?? row.enqueuedAt ?? row.updatedAt ?? row.createdAt
          : row.enqueuedAt ?? row.updatedAt ?? row.createdAt

      if (!referenceTime || now.getTime() - referenceTime.getTime() < threshold) {
        continue
      }

      const job = row.queueJobId ? await this.parseQueue.getJob(row.queueJobId).catch(() => null) : null
      const state = job ? await job.getState().catch(() => null) : null

      // Waiting, delayed, or running: the queue still owns it. A running job
      // is never duplicated here — two parses of one document would race.
      if (job && state !== 'failed' && state !== 'completed') {
        continue
      }

      if (state === 'failed') {
        // Backstop for a final attempt that could not record its own failure.
        await this.markFailed(kind, row.id, 'Parsing failed after retries', now)
        this.logger.warn(
          `Procurement parse reconciliation kind=${kind} id=${row.id} jobId=${row.queueJobId} action=failed reason=job-failed`,
        )
        continue
      }

      const requeues = this.requeueCount(row.queueJobId)
      if (requeues >= MAX_RECONCILE_REQUEUES) {
        await this.markFailed(kind, row.id, `Parsing did not finish after ${requeues + 1} attempts to run it`, now)
        this.logger.warn(
          `Procurement parse reconciliation kind=${kind} id=${row.id} jobId=${row.queueJobId ?? '(none)'} action=failed reason=requeue-cap`,
        )
        continue
      }

      // queueDoc already marks the row failed if the enqueue itself throws.
      await this.queueDoc(kind, row.id, requeues + 1).catch(() => undefined)
      this.logger.warn(
        `Procurement parse reconciliation kind=${kind} id=${row.id} jobId=${row.queueJobId ?? '(none)'} action=requeued`,
      )
    }
  }

  private async markFailed(kind: ProcurementDocKind, id: string, lastError: string, updatedAt = new Date()) {
    if (kind === 'purchase_order') {
      await db
        .update(purchaseOrders)
        .set({ status: 'failed', lastError, updatedAt })
        .where(eq(purchaseOrders.id, id))
    } else {
      await db.update(invoices).set({ status: 'failed', lastError, updatedAt }).where(eq(invoices.id, id))
    }
  }

  private getJobId(kind: ProcurementDocKind, id: string, requeue = 0) {
    const base = `procurement-parse:${kind}:${id}`
    return requeue > 0 ? `${base}:r${requeue}` : base
  }

  private requeueCount(queueJobId: string | null): number {
    const match = queueJobId?.match(/:r(\d+)$/)
    return match ? Number(match[1]) : 0
  }

  private registerQueueLogging() {
    // The repeatable reconcile job shares this queue; its data has no kind/id.
    const isParseJob = (job: Job) => job.name !== RECONCILE_JOB_NAME
    this.parseQueue.on('active', (job: Job<{ kind: ProcurementDocKind; id: string }>) => {
      if (!isParseJob(job)) return
      this.logger.log(`Procurement parse active kind=${job.data.kind} id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.parseQueue.on('completed', (job: Job<{ kind: ProcurementDocKind; id: string }>) => {
      if (!isParseJob(job)) return
      this.logger.log(`Procurement parse completed kind=${job.data.kind} id=${job.data.id} jobId=${String(job.id)}`)
    })
    this.parseQueue.on('failed', (job: Job<{ kind: ProcurementDocKind; id: string }>, error: Error) => {
      this.logger.warn(
        `Procurement parse failed name=${job.name} kind=${job.data.kind} id=${job.data.id} jobId=${String(job.id)} error=${error.message}`,
      )
    })
    this.parseQueue.on('stalled', (job: Job<{ kind: ProcurementDocKind; id: string }>) => {
      this.logger.warn(
        `Procurement parse stalled name=${job.name} kind=${job.data.kind} id=${job.data.id} jobId=${String(job.id)}`,
      )
    })
  }
}
