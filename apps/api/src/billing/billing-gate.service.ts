import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { TokenMeter } from '@repo/ai'
import { billingStop } from './billing-stop'
import { EntitlementService } from './entitlement.service'
import { currentMonthPeriod } from './plans'
import { UsageLedgerService } from './usage-ledger.service'

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
    const key = `cmp:${purchaseOrderId}:${invoiceId}`
    if (!this.enforced()) {
      await this.ledger.reserve({
        workspaceId,
        kind: 'matched_line',
        idempotencyKey: key,
        quantity: lineCount,
        limit: null,
        window: currentMonthPeriod(now),
        now,
      })
      return
    }

    const summary = await this.entitlement.resolve(workspaceId, now)
    if (summary.state === 'none') throw billingStop('SUBSCRIPTION_REQUIRED')
    const result = await this.ledger.reserve({
      workspaceId,
      kind: 'matched_line',
      idempotencyKey: key,
      quantity: lineCount,
      limit: summary.quotas?.matchedLines ?? null,
      window: summary.period
        ? { start: new Date(summary.period.start), end: new Date(summary.period.end) }
        : currentMonthPeriod(now),
      now,
    })
    if (result === 'over') throw billingStop('QUOTA_EXCEEDED', 'matchedLines')
  }

  async assertPhotoCheck(workspaceId: string, now: Date = new Date()): Promise<void> {
    const key = `photo:${randomUUID()}`
    if (!this.enforced()) {
      await this.ledger.reserve({
        workspaceId,
        kind: 'photo_check',
        idempotencyKey: key,
        quantity: 1,
        limit: null,
        window: currentMonthPeriod(now),
        now,
      })
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
      window: summary.period
        ? { start: new Date(summary.period.start), end: new Date(summary.period.end) }
        : currentMonthPeriod(now),
      now,
    })
    if (result === 'over') throw billingStop('QUOTA_EXCEEDED', 'photoChecks')
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
