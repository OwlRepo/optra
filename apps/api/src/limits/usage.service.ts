import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'

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
        `Failed chat usage increment for workspace ${workspaceId}: ${this.message(error)}`,
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
        throw new HttpException('Workspace monthly token budget reached', 402)
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.warn(
        `Failed chat usage budget check for workspace ${workspaceId}: ${this.message(error)}`,
      )
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
