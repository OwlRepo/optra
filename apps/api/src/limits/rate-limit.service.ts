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

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
