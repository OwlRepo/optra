import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import type { Job } from 'bull'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { comparisonRuns, db, goodsReceipts, invoices, purchaseOrders } from '@repo/db'
import { EventsService } from '../events/events.service'
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
    private readonly events: EventsService,
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
      const result = await this.comparison.compare(workspaceId, purchaseOrderId, invoiceId)

      // Only when it found something. A clean automatic run is not news, and
      // `unreadCount` has no per-type filter and `markSeen` one global
      // watermark, so it would climb the Overview badge with nothing behind it.
      // This is also why the type is `comparison_flagged` and not
      // `comparison_completed` — an event named for completion that stays
      // silent on most completions is a name a later reader has to disprove.
      if (result.flags.length > 0) {
        await this.announce(
          workspaceId,
          'comparison_flagged',
          result.runId,
          purchaseOrderId,
          `${result.flags.length} ${result.flags.length === 1 ? 'discrepancy' : 'discrepancies'} to review`,
        )
      }
    } catch (error) {
      if (isPermanentCompareError(error)) {
        // No run row exists to point an event at, and a pair that resolved and
        // should not have is a line for the log rather than the feed.
        this.logger.warn(
          `Auto-compare abandoned workspace=${workspaceId} po=${purchaseOrderId} invoice=${invoiceId}: ` +
            `${error instanceof Error ? error.message : 'unknown error'}`,
        )
        return
      }

      const runId = await this.lastFailedAutomaticRun(workspaceId, purchaseOrderId, invoiceId)
      if (runId) {
        await this.announce(workspaceId, 'comparison_failed', runId, purchaseOrderId, 'Comparison did not finish')
      }
      throw error
    }
  }

  /**
   * Fire and forget, after the run's terminal state is already persisted —
   * the discipline every existing `EventsService.record` caller follows, and
   * `record` itself throws. A feed that refuses an entry must not undo a
   * comparison that really happened.
   *
   * The title names the purchase order because that is what a reviewer
   * recognises; `entityId` is the run, which is where the evidence lives.
   * Same split as `scrape_completed` (title `Crawl of <url>`, entity the run).
   */
  private async announce(
    workspaceId: string,
    type: 'comparison_flagged' | 'comparison_failed',
    runId: string,
    purchaseOrderId: string,
    detail: string,
  ): Promise<void> {
    try {
      const [po] = await db
        .select({ poNumber: purchaseOrders.poNumber, name: purchaseOrders.name })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.workspaceId, workspaceId)))
        .limit(1)

      await this.events.record(workspaceId, type, runId, po?.poNumber ?? po?.name ?? 'Comparison', detail)
    } catch (error) {
      this.logger.warn(
        `Auto-compare event not recorded type=${type} workspace=${workspaceId} run=${runId}: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  /**
   * The run this attempt just failed. `compare()` writes the row and closes it
   * as `failed` before rethrowing, so it exists — but it does not hand back the
   * id, and widening its signature to do so belongs to a different change.
   *
   * Scoped to automatic runs of this pair, newest first. Two automatic jobs for
   * one pair are already made unlikely by the versioned job id and the
   * freshness check; if one ever did overlap, this names a sibling failed run
   * of the same pair rather than anything untrue.
   */
  private async lastFailedAutomaticRun(
    workspaceId: string,
    purchaseOrderId: string,
    invoiceId: string,
  ): Promise<string | null> {
    const [run] = await db
      .select({ id: comparisonRuns.id })
      .from(comparisonRuns)
      .where(
        and(
          eq(comparisonRuns.workspaceId, workspaceId),
          eq(comparisonRuns.purchaseOrderId, purchaseOrderId),
          eq(comparisonRuns.invoiceId, invoiceId),
          eq(comparisonRuns.status, 'failed'),
          isNull(comparisonRuns.initiatedBy),
        ),
      )
      .orderBy(desc(comparisonRuns.startedAt), desc(comparisonRuns.id))
      .limit(1)
    return run?.id ?? null
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
