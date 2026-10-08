import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { TokenMeter } from '@repo/ai'
import { billingStop } from './billing-stop'
import { EntitlementService } from './entitlement.service'
import { currentMonthPeriod } from './plans'
import { UsageLedgerService } from './usage-ledger.service'
import type { BillingSummary } from '@repo/types'

/** The quota window of a summary; exempt and none read the UTC calendar month. */
function windowOf(summary: BillingSummary, now: Date): { start: Date; end: Date } {
  return summary.period
    ? { start: new Date(summary.period.start), end: new Date(summary.period.end) }
    : currentMonthPeriod(now)
}

/** cmp:{po}:{invoice}:{period start date}: one pair is counted once per period. */
function pairKeyPrefix(purchaseOrderId: string, invoiceId: string, periodStart: Date): string {
  return `cmp:${purchaseOrderId}:${invoiceId}:${periodStart.toISOString().slice(0, 10)}`
}

/**
 * Every metered path asks this gate. With BILLING_ENFORCEMENT off it refuses
 * nothing for billing and only records; with `on` it throws a coded 402.
 * A database error in an enforced check propagates (fail-closed).
 */
@Injectable()
export class BillingGateService {
  private readonly logger = new Logger(BillingGateService.name)

  constructor(
    private readonly config: ConfigService,
    private readonly entitlement: EntitlementService,
    private readonly ledger: UsageLedgerService,
  ) {}

  private enforced(): boolean {
    return this.config.get<string>('BILLING_ENFORCEMENT') === 'on'
  }

  async assertAiBudget(workspaceId: string, now: Date = new Date()): Promise<void> {
    if (!this.enforced()) return
    const { summary, ai } = await this.entitlement.resolveWithAiBudget(workspaceId, now)
    if (summary.state === 'none') throw billingStop('SUBSCRIPTION_REQUIRED')
    if (ai.usedMicroUsd >= ai.capMicroUsd) throw billingStop('AI_BUDGET_EXCEEDED')
  }

  async assertMatchedLines(
    workspaceId: string,
    purchaseOrderId: string,
    invoiceId: string,
    lineCount: number,
    now: Date = new Date(),
  ): Promise<void> {
    if (!this.enforced()) {
      const window = currentMonthPeriod(now)
      await this.bestEffort(workspaceId, 'matched-line', () =>
        this.ledger.reservePairLines({
          workspaceId,
          keyPrefix: pairKeyPrefix(purchaseOrderId, invoiceId, window.start),
          lineCount,
          limit: null,
          window,
          now,
        }),
      )
      return
    }

    const summary = await this.entitlement.resolve(workspaceId, now)
    if (summary.state === 'none') throw billingStop('SUBSCRIPTION_REQUIRED')
    const window = windowOf(summary, now)
    const result = await this.ledger.reservePairLines({
      workspaceId,
      keyPrefix: pairKeyPrefix(purchaseOrderId, invoiceId, window.start),
      lineCount,
      limit: summary.quotas?.matchedLines ?? null,
      window,
      now,
    })
    if (result === 'over') throw billingStop('QUOTA_EXCEEDED', 'matchedLines')
  }

  async assertPhotoCheck(workspaceId: string, now: Date = new Date()): Promise<void> {
    const key = `photo:${randomUUID()}`
    if (!this.enforced()) {
      await this.bestEffort(workspaceId, 'photo-check', () =>
        this.ledger.reserve({
          workspaceId,
          kind: 'photo_check',
          idempotencyKey: key,
          quantity: 1,
          limit: null,
          window: currentMonthPeriod(now),
          now,
        }),
      )
      return
    }

    const { summary, ai } = await this.entitlement.resolveWithAiBudget(workspaceId, now)
    if (summary.state === 'none') throw billingStop('SUBSCRIPTION_REQUIRED')
    if (ai.usedMicroUsd >= ai.capMicroUsd) throw billingStop('AI_BUDGET_EXCEEDED')
    const result = await this.ledger.reserve({
      workspaceId,
      kind: 'photo_check',
      idempotencyKey: key,
      quantity: 1,
      limit: summary.quotas?.photoChecks ?? null,
      window: windowOf(summary, now),
      now,
    })
    if (result === 'over') throw billingStop('QUOTA_EXCEEDED', 'photoChecks')
  }

  // Off mode refuses nothing for billing, so a ledger outage must not break the
  // feature either: warn once and carry on (the row is lost, an under-count).
  private async bestEffort(workspaceId: string, what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.logger.warn(
        `${what} ledger write failed workspace=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Named band-aid: a lost write under-counts one call. Durable alternative
  // (an outbox) was rejected as over-engineering for one indexed insert.
  async recordLlmCost(workspaceId: string, meter: TokenMeter, now: Date = new Date()): Promise<void> {
    try {
      await this.ledger.recordLlmCost({ workspaceId, meter, now })
    } catch (error) {
      this.logger.warn(
        `llm_cost ledger write failed workspace=${workspaceId} microUsd=${meter.costMicroUsd}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
