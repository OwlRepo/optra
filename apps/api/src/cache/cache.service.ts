import { createHash } from 'crypto'
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { chatCache, db, type ChatMessageSource } from '@repo/db'
import type Redis from 'ioredis'
import { sql } from 'drizzle-orm'

type CachedAnswer = {
  answer: string
  sources: ChatMessageSource[]
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined)
  }

  async getVersion(workspaceId: string): Promise<number> {
    try {
      const versionKey = `chat:ver:${workspaceId}`
      const value = await this.redis.get(versionKey)
      if (value === null) {
        if ('setnx' in this.redis && typeof this.redis.setnx === 'function') {
          await this.redis.setnx(versionKey, '1')
        } else {
          await this.redis.set(versionKey, '1')
        }
        return 1
      }

      const parsed = value ? Number.parseInt(value, 10) : Number.NaN
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    } catch (error) {
      this.logger.warn(`Failed to read chat cache version for workspace ${workspaceId}: ${this.message(error)}`)
      return 1
    }
  }

  async bumpVersion(workspaceId: string): Promise<void> {
    try {
      await this.redis.incr(`chat:ver:${workspaceId}`)
    } catch (error) {
      this.logger.warn(`Failed to bump chat cache version for workspace ${workspaceId}: ${this.message(error)}`)
    }
  }

  async getExact(workspaceId: string, message: string): Promise<CachedAnswer | null> {
    try {
      const version = await this.getVersion(workspaceId)
      const value = await this.redis.get(this.key(workspaceId, version, message))

      if (!value) {
        return null
      }

      return JSON.parse(value) as CachedAnswer
    } catch (error) {
      this.logger.warn(`Failed exact chat cache lookup for workspace ${workspaceId}: ${this.message(error)}`)
      return null
    }
  }

  async setExact(
    workspaceId: string,
    message: string,
    answer: string,
    sources: ChatMessageSource[],
  ): Promise<void> {
    try {
      const version = await this.getVersion(workspaceId)
      const ttl = Number.parseInt(
        this.config.get<string>('CHAT_CACHE_TTL_SECONDS', '3600'),
        10,
      )

      await this.redis.set(
        this.key(workspaceId, version, message),
        JSON.stringify({ answer, sources }),
        'EX',
        Number.isFinite(ttl) && ttl > 0 ? ttl : 3600,
      )
    } catch (error) {
      this.logger.warn(`Failed exact chat cache write for workspace ${workspaceId}: ${this.message(error)}`)
    }
  }

  async getSemantic(workspaceId: string, embedding: number[]): Promise<CachedAnswer | null> {
    try {
      const version = await this.getVersion(workspaceId)
      const threshold = Number.parseFloat(
        this.config.get<string>('SEMANTIC_CACHE_THRESHOLD', '0.95'),
      )
      const ttlHours = this.semanticCacheTtlHours()
      const vectorLiteral = this.vectorLiteral(embedding)
      const result = await db.execute(sql`
        select
          answer,
          sources,
          1 - (question_embedding <=> ${vectorLiteral}) as score
        from chat_cache
        where workspace_id = ${workspaceId}
          and version = ${version}
          and created_at > now() - make_interval(hours => ${ttlHours})
        order by question_embedding <=> ${vectorLiteral}
        limit 1
      `)

      const rows = 'rows' in result ? result.rows : result
      const hit = rows[0] as
        | { answer: string; sources: ChatMessageSource[] | null; score: number | string }
        | undefined
      const score = typeof hit?.score === 'string' ? Number.parseFloat(hit.score) : hit?.score
      if (!hit || !Number.isFinite(score) || score < threshold) {
        return null
      }

      return {
        answer: hit.answer,
        sources: hit.sources ?? [],
      }
    } catch (error) {
      this.logger.warn(`Failed semantic chat cache lookup for workspace ${workspaceId}: ${this.message(error)}`)
      return null
    }
  }

  async saveSemantic(
    workspaceId: string,
    version: number,
    message: string,
    embedding: number[],
    answer: string,
    sources: ChatMessageSource[],
  ): Promise<void> {
    try {
      await db.insert(chatCache).values({
        workspaceId,
        version,
        question: message,
        questionEmbedding: embedding,
        answer,
        sources,
      })
    } catch (error) {
      this.logger.warn(`Failed semantic chat cache write for workspace ${workspaceId}: ${this.message(error)}`)
      return
    }

    try {
      await this.deleteExpiredSemanticCache(workspaceId)
    } catch (error) {
      this.logger.warn(
        `Failed expired semantic chat cache cleanup for workspace ${workspaceId}: ${this.message(error)}`,
      )
    }
  }

  private key(workspaceId: string, version: number, message: string) {
    return `chat:ans:${workspaceId}:${version}:${this.hash(this.normalize(message))}`
  }

  private normalize(message: string) {
    return message.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  private hash(message: string) {
    return createHash('sha256').update(message).digest('hex')
  }

  private vectorLiteral(embedding: number[]) {
    return sql.raw(`'[${embedding.join(',')}]'::vector`)
  }

  private semanticCacheTtlHours() {
    return Number.parseInt(this.config.get<string>('SEMANTIC_CACHE_TTL_HOURS', '24'), 10)
  }

  private async deleteExpiredSemanticCache(workspaceId: string): Promise<void> {
    const ttlHours = this.semanticCacheTtlHours()
    await db.execute(sql`
      delete from chat_cache
      where workspace_id = ${workspaceId}
        and created_at <= now() - make_interval(hours => ${ttlHours})
    `)
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
