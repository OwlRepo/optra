import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TokenMeter } from '@repo/ai'
import type Redis from 'ioredis'

const BUDGET_EXCEEDED_STATUS = 402

// Background jobs use this to treat "budget reached" as a final outcome (no
// Bull retry: the budget will not refill before the retry fires).
export function isBudgetExceeded(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === BUDGET_EXCEEDED_STATUS
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
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

  async assertWithinBudget(workspaceId: string) {
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
  // a meter, and charge whatever the provider reported — in `finally`, so
  // tokens spent before a parse/validation error are still counted.
  async metered<T>(workspaceId: string, run: (meter: TokenMeter) => Promise<T>): Promise<T> {
    await this.assertWithinBudget(workspaceId)
    const meter = new TokenMeter()
    try {
      return await run(meter)
    } finally {
      if (meter.total > 0) {
        await this.addUsage(workspaceId, meter.total)
      }
    }
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
