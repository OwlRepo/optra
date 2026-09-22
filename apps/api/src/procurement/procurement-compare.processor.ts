import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import type { Job } from 'bull'
import { and, desc, eq } from 'drizzle-orm'
import { comparisonRuns, db, goodsReceipts, invoices, purchaseOrders } from '@repo/db'
import { COMPARISON_STRATEGY_VERSION, ComparisonService } from './comparison.service'
import { COMPARE_RECONCILE_JOB_NAME, ComparePairJob, ProcurementCompareService } from './procurement-compare.service'

/**
 * Mirrors `isPermanentParseError`. A permanent failure is one a retry cannot
 * fix: the document is gone, or it is not in a state that can be compared.
 *
 * Both are ordinary outcomes of automation racing a human. Someone deletes an
 * invoice while its comparison sits delayed; a re-parse empties a document
 * between enqueue and run. Rethrowing either would retry a job whose answer can
 * only ever be the same exception — and, in the e2e suite, would race a
 * teardown that is deleting those very rows into foreign-key violations.
 *
 * So a permanent failure is logged and swallowed. Nothing is written: compare()
 * refuses these before it creates a run row, so there is no half-finished run
 * to close and nothing to show a reviewer. The pair is recovered by the next
 * parse of either document, or by the manual Compare button.
 */
function isPermanentCompareError(error: unknown): boolean {
  return error instanceof NotFoundException || error instanceof BadRequestException
}

@Processor('procurement-compare-queue')
export class ProcurementCompareProcessor {
  private readonly logger = new Logger(ProcurementCompareProcessor.name)

  constructor(
    private readonly comparison: ComparisonService,
    private readonly compareService: ProcurementCompareService,
  ) {}

  @Process(COMPARE_RECONCILE_JOB_NAME)
  async handleReconcile(): Promise<void> {
    await this.compareService.reconcile()
  }

  @Process()
  async handlePair(job: Job<ComparePairJob>): Promise<void> {
    const { workspaceId, purchaseOrderId, invoiceId } = job.data

    if (await this.isUpToDate(workspaceId, purchaseOrderId, invoiceId)) {
      this.logger.log(
        `Auto-compare skipped workspace=${workspaceId} po=${purchaseOrderId} invoice=${invoiceId} reason=unchanged`,
      )
      return
    }

    try {
      // No `initiatedBy`. That null is what makes the run distinguishable as
      // automatic — S7's review panel already renders it that way — rather than
      // attributing machine-written evidence to whoever happened to upload.
      await this.comparison.compare(workspaceId, purchaseOrderId, invoiceId)
    } catch (error) {
      if (isPermanentCompareError(error)) {
        this.logger.warn(
          `Auto-compare abandoned workspace=${workspaceId} po=${purchaseOrderId} invoice=${invoiceId}: ` +
            `${error instanceof Error ? error.message : 'unknown error'}`,
        )
        return
      }
      throw error
    }
  }

  /**
   * Whether the pair's latest succeeded run already accounts for every document
   * feeding it. This is the only thing bounding how many runs automation can
   * write, and every run is permanent evidence that POLICY v1 #9's retention
   * guard then refuses to let anyone delete.
   *
   * It compares against `started_at`, not `finished_at` and not `created_at`,
   * with a strict `>`. A run that started at T0, read its lines, and finished
   * at T2 saw nothing of a re-parse at T1 — comparing against T2 would call
   * that run current when it is a torn read of a document that changed
   * underneath it. `started_at` is the moment the inputs were actually read.
   *
   * `strategy_version` is part of the predicate so that bumping the engine
   * invalidates every stored verdict at once, instead of leaving pairs pinned
   * to an answer the current rules would no longer give.
   *
   * Receipts are included because a receipt is neither of the two named
   * documents and still changes the verdict — the case a freshness check
   * written from the job payload alone would miss.
   */
  private async isUpToDate(workspaceId: string, purchaseOrderId: string, invoiceId: string): Promise<boolean> {
    const [latest] = await db
      .select({ startedAt: comparisonRuns.startedAt })
      .from(comparisonRuns)
      .where(
        and(
          eq(comparisonRuns.workspaceId, workspaceId),
          eq(comparisonRuns.purchaseOrderId, purchaseOrderId),
          eq(comparisonRuns.invoiceId, invoiceId),
          eq(comparisonRuns.status, 'succeeded'),
          eq(comparisonRuns.strategyVersion, COMPARISON_STRATEGY_VERSION),
        ),
      )
      .orderBy(desc(comparisonRuns.startedAt), desc(comparisonRuns.id))
      .limit(1)
    if (!latest) return false

    const [po] = await db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.workspaceId, workspaceId)))
      .limit(1)
    const [invoice] = await db
      .select({ updatedAt: invoices.updatedAt })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .limit(1)
    // A document that has gone missing is not "unchanged" — fall through and
    // let compare() give the authoritative refusal.
    if (!po || !invoice) return false

    // Only `done` receipts, matching what compare() will actually read since
    // S8 commit 1. An unsettled receipt cannot make a run stale, because it
    // contributes nothing to the run in the first place.
    const receipts = await db
      .select({ updatedAt: goodsReceipts.updatedAt })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.workspaceId, workspaceId),
          eq(goodsReceipts.purchaseOrderId, purchaseOrderId),
          eq(goodsReceipts.status, 'done'),
        ),
      )

    const newestInput = [po.updatedAt, invoice.updatedAt, ...receipts.map((receipt) => receipt.updatedAt)].reduce(
      (newest, stamp) => (stamp > newest ? stamp : newest),
    )

    return latest.startedAt > newestInput
  }
}
