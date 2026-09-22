import { randomUUID } from 'crypto'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import type { Queue } from 'bull'
import { and, eq, lt } from 'drizzle-orm'
import { comparisonRuns, db, goodsReceipts, invoices, purchaseOrders } from '@repo/db'
import { autoCompareEnabled } from './procurement-feature-flags'
import { assertUnreachable } from './procurement-kind'
import type { ProcurementDocKind } from './procurement-parse.service'

/**
 * How long a burst of parses for one pair is allowed to collapse into a single
 * job. While a job sits delayed under a given id, Bull returns that job for a
 * second `add` with the same id — which is the only window in which a
 * deterministic id deduplicates anything, because `removeOnComplete` frees the
 * id the moment a job finishes.
 *
 * Which is exactly why the id carries the input version (see `jobIdFor`). A
 * FIXED id plus this delay would coalesce a *changed* state into a job already
 * in flight that had read the old lines — the second document's parse would be
 * silently swallowed by the first document's job. Versioning the id means only
 * an enqueue for the identical state is ever deduplicated, which is the only
 * kind that is safe to drop.
 *
 * So the delay is an optimisation, not the correctness mechanism — it saves a
 * run when two documents for one pair land together. The thing that actually
 * bounds run growth is the freshness check in the processor, which is why this
 * window can be short.
 */
const COMPARE_COALESCE_MS = 5_000
const COMPARE_JOB_TIMEOUT_MS = 2 * 60_000
/** A run is capped at 10s of engine time, so ten minutes is not a close call. */
const COMPARE_RUN_STALE_MS = 10 * 60_000
const RECONCILE_EVERY_MS = 5 * 60_000

export const COMPARE_RECONCILE_JOB_NAME = 'reconcile-runs'

export interface ComparePairJob {
  workspaceId: string
  purchaseOrderId: string
  invoiceId: string
}

interface ResolvedPair {
  job: ComparePairJob
  /**
   * The newest `updated_at` across every document feeding this comparison —
   * the purchase order, the invoice, and each of the order's `done` receipts.
   * A re-parse always moves `updated_at`, so this changes whenever the answer
   * could change, and only then.
   */
  inputVersionMs: number
}

function jobIdFor(pair: ResolvedPair): string {
  return `procurement-compare:${pair.job.purchaseOrderId}:${pair.job.invoiceId}:${pair.inputVersionMs}`
}

/**
 * Turns "a document finished parsing" into "compare the pairs it affects".
 *
 * A separate queue rather than an inline call at the end of the parse job: a
 * comparison spins up its own 256MB in-memory DuckDB, and charging that to the
 * parse job's timeout would make a slow comparison look like a failed parse.
 * The shape — a processor handing work to another module's queueing service —
 * is the one `ScrapeProcessor` already uses for `IngestService.queueDocument`.
 */
@Injectable()
export class ProcurementCompareService implements OnModuleInit {
  private readonly logger = new Logger(ProcurementCompareService.name)

  constructor(@InjectQueue('procurement-compare-queue') private compareQueue: Queue) {}

  async onModuleInit() {
    await this.compareQueue.add(
      COMPARE_RECONCILE_JOB_NAME,
      {},
      {
        jobId: 'procurement-compare-reconcile',
        repeat: { every: RECONCILE_EVERY_MS },
        removeOnComplete: true,
      },
    )
  }

  /**
   * Every pair whose answer this document could have changed.
   *
   * Only `done` counterparts are enqueued. `compare()` would refuse the rest
   * anyway, and a job whose only possible outcome is a 400 is noise in the
   * queue rather than a safety net.
   */
  async enqueueForDocument(kind: ProcurementDocKind, id: string): Promise<void> {
    if (!autoCompareEnabled()) return

    const pairs = await this.pairsFor(kind, id)
    for (const pair of pairs) {
      await this.compareQueue.add(pair.job, {
        jobId: jobIdFor(pair),
        delay: COMPARE_COALESCE_MS,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: COMPARE_JOB_TIMEOUT_MS,
        removeOnComplete: true,
        removeOnFail: false,
      })
    }

    if (pairs.length > 0) {
      this.logger.log(`Auto-compare enqueued kind=${kind} id=${id} pairs=${pairs.length}`)
    }
  }

  private async pairsFor(kind: ProcurementDocKind, id: string): Promise<ResolvedPair[]> {
    switch (kind) {
      case 'purchase_order':
        return this.pairsForPurchaseOrder(id)
      case 'invoice': {
        const [invoice] = await db
          .select({
            workspaceId: invoices.workspaceId,
            purchaseOrderId: invoices.purchaseOrderId,
            status: invoices.status,
            updatedAt: invoices.updatedAt,
          })
          .from(invoices)
          .where(eq(invoices.id, id))
          .limit(1)
        // A null link is the pre-0025 legacy shape. compare() still accepts it
        // when a human picks both sides, but nothing about it is discoverable.
        if (!invoice?.purchaseOrderId || invoice.status !== 'done') return []

        const [po] = await db
          .select({ id: purchaseOrders.id, updatedAt: purchaseOrders.updatedAt })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.id, invoice.purchaseOrderId),
              eq(purchaseOrders.workspaceId, invoice.workspaceId),
              eq(purchaseOrders.status, 'done'),
            ),
          )
          .limit(1)
        if (!po) return []

        const receipts = await this.receiptState(invoice.workspaceId, po.id)
        if (receipts.defer) return []

        return [
          {
            job: { workspaceId: invoice.workspaceId, purchaseOrderId: po.id, invoiceId: id },
            inputVersionMs: Math.max(po.updatedAt.getTime(), invoice.updatedAt.getTime(), receipts.versionMs),
          },
        ]
      }
      case 'goods_receipt': {
        // A receipt answers an order, not an invoice, so what it changes is
        // that order against each of its invoices.
        const [receipt] = await db
          .select({ workspaceId: goodsReceipts.workspaceId, purchaseOrderId: goodsReceipts.purchaseOrderId })
          .from(goodsReceipts)
          .where(eq(goodsReceipts.id, id))
          .limit(1)
        if (!receipt) return []
        return this.pairsForPurchaseOrder(receipt.purchaseOrderId)
      }
      default:
        return assertUnreachable(kind)
    }
  }

  private async pairsForPurchaseOrder(purchaseOrderId: string): Promise<ResolvedPair[]> {
    const [po] = await db
      .select({
        id: purchaseOrders.id,
        workspaceId: purchaseOrders.workspaceId,
        status: purchaseOrders.status,
        updatedAt: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .limit(1)
    if (!po || po.status !== 'done') return []

    const receipts = await this.receiptState(po.workspaceId, po.id)
    if (receipts.defer) return []

    const linked = await db
      .select({ id: invoices.id, updatedAt: invoices.updatedAt })
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, po.workspaceId),
          eq(invoices.purchaseOrderId, po.id),
          eq(invoices.status, 'done'),
        ),
      )

    return linked.map((invoice) => ({
      job: { workspaceId: po.workspaceId, purchaseOrderId: po.id, invoiceId: invoice.id },
      inputVersionMs: Math.max(po.updatedAt.getTime(), invoice.updatedAt.getTime(), receipts.versionMs),
    }))
  }

  /**
   * Whether this order's receiving side has settled, and how new it is.
   *
   * `defer` when any linked receipt is still `pending` or `processing`. That
   * receipt's own parse completion calls back into this service, so waiting
   * costs one enqueue and nothing else — while comparing now would publish a
   * verdict computed as though the delivery had not happened.
   *
   * A `failed` receipt is deliberately NOT deferred for. Nothing is coming to
   * re-enqueue on its behalf, so waiting for it means never comparing at all;
   * and since S8 commit 1 its lines are excluded from compare() anyway, so the
   * verdict it would produce is the honest two-way one.
   *
   * `versionMs` counts only `done` receipts, for the same reason: an unsettled
   * receipt contributes nothing to the answer, so it must not contribute to the
   * identity of the job that computes it.
   */
  private async receiptState(workspaceId: string, purchaseOrderId: string): Promise<{
    defer: boolean
    versionMs: number
  }> {
    const receipts = await db
      .select({ status: goodsReceipts.status, updatedAt: goodsReceipts.updatedAt })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.workspaceId, workspaceId), eq(goodsReceipts.purchaseOrderId, purchaseOrderId)))

    const defer = receipts.some((receipt) => receipt.status === 'pending' || receipt.status === 'processing')
    const versionMs = receipts
      .filter((receipt) => receipt.status === 'done')
      .reduce((newest, receipt) => Math.max(newest, receipt.updatedAt.getTime()), 0)

    return { defer, versionMs }
  }

  /**
   * A run row is written when a comparison starts, so a process that dies
   * mid-run leaves `running` behind forever. Nothing swept those before — this
   * fixes the same defect for manual comparisons, which have always had it.
   *
   * What it cannot see: a job enqueued and then lost before it ever ran writes
   * no row at all. That is recovered by the next parse of either document, or
   * by the manual Compare button.
   */
  async reconcile(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - COMPARE_RUN_STALE_MS)
    const stale = await db
      .select({ id: comparisonRuns.id, workspaceId: comparisonRuns.workspaceId })
      .from(comparisonRuns)
      .where(and(eq(comparisonRuns.status, 'running'), lt(comparisonRuns.startedAt, cutoff)))

    for (const run of stale) {
      const reference = randomUUID().slice(0, 8)
      await db
        .update(comparisonRuns)
        .set({
          status: 'failed',
          lastError: `Comparison did not finish. Reference: ${reference}`,
          finishedAt: now,
        })
        .where(eq(comparisonRuns.id, run.id))
      this.logger.warn(
        `Comparison run abandoned ref=${reference} workspace=${run.workspaceId} run=${run.id} action=failed reason=stale`,
      )
    }
  }
}
