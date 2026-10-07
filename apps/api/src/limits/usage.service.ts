import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TokenMeter } from '@repo/ai'
import type Redis from 'ioredis'
import { BillingGateService } from '../billing/billing-gate.service'

const BUDGET_EXCEEDED_STATUS = 402

// Background jobs use this to treat "budget reached" as a final outcome (no
// Bull retry: the budget will not refill before the retry fires). Keys on the
// status, so the legacy token-budget 402 and the coded billing 402s all count.
export function isBudgetExceeded(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === BUDGET_EXCEEDED_STATUS
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly gate: BillingGateService,
  ) {}

  async addUsage(workspaceId: string, tokens: number) {
    const key = this.monthKey(workspaceId)

    try {
      await this.redis.incrby(key, tokens)
      await this.redis.expire(key, 60 * 60 * 24 * 40)
    } catch (error) {
      this.logger.warn(
        `Failed token usage increment for workspace ${workspaceId}: ${this.message(error)}`,
      )
    }
  }

  // BILLING_ENFORCEMENT=on: the Postgres ledger and the plan's dollar cap decide
  // (state none -> 402 SUBSCRIPTION_REQUIRED, over cap -> 402 AI_BUDGET_EXCEEDED;
  // a database error propagates: fail-closed). Anything else: the Redis token
  // limit exactly as before (fail-open on a Redis error, 402 without a code).
  async assertWithinBudget(workspaceId: string) {
    if (this.enforced()) {
      await this.gate.assertAiBudget(workspaceId)
      return
    }

    const key = this.monthKey(workspaceId)
    const budget = Number.parseInt(
      this.config.get<string>('MAX_TOKENS_PER_WORKSPACE_MONTH', '5000000'),
      10,
    )

    try {
      const raw = await this.redis.get(key)
      const used = raw ? Number.parseInt(raw, 10) : 0

      if (used >= budget) {
        throw new HttpException('Workspace monthly token budget reached', BUDGET_EXCEEDED_STATUS)
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.warn(
        `Failed token usage budget check for workspace ${workspaceId}: ${this.message(error)}`,
      )
    }
  }

  // The one way a model call is charged: check the budget first, give the call
  // a meter, and charge whatever the provider reported, in `finally`, so tokens
  // spent before a parse/validation error are still counted. Both modes write
  // one llm_cost ledger row. `ledgerOnly` is for the paths that never had the
  // Redis token budget (refine): off mode checks nothing and charges no Redis
  // tokens, on mode checks the dollar cap, and the ledger row is written.
  async metered<T>(
    workspaceId: string,
    run: (meter: TokenMeter) => Promise<T>,
    options: { ledgerOnly?: boolean } = {},
  ): Promise<T> {
    if (options.ledgerOnly) {
      if (this.enforced()) await this.gate.assertAiBudget(workspaceId)
    } else {
      await this.assertWithinBudget(workspaceId)
    }
    const meter = new TokenMeter()
    try {
      return await run(meter)
    } finally {
      if (meter.total > 0) {
        if (!options.ledgerOnly) await this.addUsage(workspaceId, meter.total)
        await this.recordLedger(workspaceId, meter)
      }
    }
  }

  /** Writes one llm_cost row for a meter that was charged outside metered() (the chat answer stream). Never throws. */
  async recordLedger(workspaceId: string, meter: TokenMeter): Promise<void> {
    await this.gate.recordLlmCost(workspaceId, meter)
  }

  private enforced() {
    return this.config.get<string>('BILLING_ENFORCEMENT') === 'on'
  }

  private monthKey(workspaceId: string) {
    const now = new Date(Date.now())
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return `usage:tok:${workspaceId}:${year}${month}`
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
