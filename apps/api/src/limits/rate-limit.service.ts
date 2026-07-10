import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async check(userId: string, workspaceId: string) {
    const perUser = Number.parseInt(
      this.config.get<string>('CHAT_RATE_LIMIT_PER_MIN_PER_USER', '20'),
      10,
    )
    const perWorkspace = Number.parseInt(
      this.config.get<string>('CHAT_RATE_LIMIT_PER_MIN_PER_WORKSPACE', '200'),
      10,
    )
    const minuteBucket = Math.floor(Date.now() / 60_000)
    const userKey = `rl:user:${userId}:${minuteBucket}`
    const workspaceKey = `rl:ws:${workspaceId}:${minuteBucket}`

    try {
      const userCount = await this.redis.incr(userKey)
      if (userCount === 1) {
        await this.redis.expire(userKey, 60)
      }

      const workspaceCount = await this.redis.incr(workspaceKey)
      if (workspaceCount === 1) {
        await this.redis.expire(workspaceKey, 60)
      }

      if (userCount > perUser || workspaceCount > perWorkspace) {
        throw new HttpException('Rate limit exceeded', 429)
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.warn(
        `Failed chat rate-limit check for user ${userId} workspace ${workspaceId}: ${this.message(error)}`,
      )
    }
  }

  /** Per-user daily cap on "Refine with Optra" requests. Resets at UTC midnight. */
  async checkRefineDaily(userId: string) {
    const limit = Number.parseInt(
      this.config.get<string>('REFINE_DAILY_LIMIT_PER_USER', '20'),
      10,
    )
    const key = `rl:refine:${userId}:${this.utcDateBucket()}`

    try {
      const count = await this.redis.incr(key)
      if (count === 1) {
        await this.redis.expire(key, 60 * 60 * 24)
      }

      if (count > limit) {
        throw new HttpException('Daily refine limit reached', 429)
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.warn(
        `Failed refine rate-limit check for user ${userId}: ${this.message(error)}`,
      )
    }
  }

  /** Read-only lookup of the current day's refine usage. Never increments the counter. */
  async getRefineStatus(userId: string): Promise<{ used: number; limit: number; remaining: number }> {
    const limit = Number.parseInt(
      this.config.get<string>('REFINE_DAILY_LIMIT_PER_USER', '20'),
      10,
    )
    const key = `rl:refine:${userId}:${this.utcDateBucket()}`

    try {
      const raw = await this.redis.get(key)
      const used = raw ? Number.parseInt(raw, 10) : 0
      return { used, limit, remaining: Math.max(0, limit - used) }
    } catch (error) {
      this.logger.warn(
        `Failed refine status lookup for user ${userId}: ${this.message(error)}`,
      )
      return { used: 0, limit, remaining: limit }
    }
  }

  private utcDateBucket(): string {
    const now = new Date(Date.now())
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
