import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { chatQueryMetrics, db } from '@repo/db'
import { sql } from 'drizzle-orm'
import type Redis from 'ioredis'

// V2 F7a panel 1+2: live rollups over S3's chat_query_metrics — no migration,
// no job needed, cheap enough to compute per-request.
const SUMMARY_WINDOW_DAYS = Number.parseInt(process.env.COVERAGE_SUMMARY_WINDOW_DAYS ?? '30', 10)
export const LOW_SCORE_THRESHOLD = Number.parseFloat(process.env.COVERAGE_LOW_SCORE_THRESHOLD ?? '0.4')
const LOW_SCORE_LIMIT = 20

export interface CoverageSummary {
  totalQueries: number
  fallbackRate: number
  cacheHitRate: number
  avgTopScore: number | null
}

// Panel 3: written by TopicGapProcessor (weekly job), read here. Cached in
// Redis, not Postgres — no migration for this slice, per the plan's own
// risk classification for F7a.
export interface TopicGap {
  label: string
  questionCount: number
  exampleQuestion: string
}

export function topicGapsRedisKey(workspaceId: string): string {
  return `insights:topic-gaps:${workspaceId}`
}

@Injectable()
export class CoverageDashboardService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async getTopicGaps(workspaceId: string): Promise<TopicGap[]> {
    const cached = await this.redis.get(topicGapsRedisKey(workspaceId))
    return cached ? (JSON.parse(cached) as TopicGap[]) : []
  }
  async getSummary(workspaceId: string): Promise<CoverageSummary> {
    const result = await db.execute<{
      total: number
      fallbackCount: number
      cacheHits: number
      avgTopScore: number | null
    }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_fallback)::int AS "fallbackCount",
        COUNT(*) FILTER (WHERE cache_status IN ('exact', 'semantic'))::int AS "cacheHits",
        AVG(top_score) AS "avgTopScore"
      FROM chat_query_metrics
      WHERE workspace_id = ${workspaceId}::uuid
        AND created_at >= now() - make_interval(days => ${SUMMARY_WINDOW_DAYS})
    `)

    const row = result.rows[0]
    const total = row?.total ?? 0

    return {
      totalQueries: total,
      fallbackRate: total > 0 ? row.fallbackCount / total : 0,
      cacheHitRate: total > 0 ? row.cacheHits / total : 0,
      avgTopScore: row?.avgTopScore !== null && row?.avgTopScore !== undefined ? Number(row.avgTopScore) : null,
    }
  }

  async getLowScoreQueries(workspaceId: string) {
    return db
      .select({
        id: chatQueryMetrics.id,
        question: chatQueryMetrics.question,
        topScore: chatQueryMetrics.topScore,
        isFallback: chatQueryMetrics.isFallback,
        createdAt: chatQueryMetrics.createdAt,
      })
      .from(chatQueryMetrics)
      .where(
        and(
          eq(chatQueryMetrics.workspaceId, workspaceId),
          or(eq(chatQueryMetrics.isFallback, true), lt(chatQueryMetrics.topScore, LOW_SCORE_THRESHOLD)),
        ),
      )
      .orderBy(desc(chatQueryMetrics.createdAt))
      .limit(LOW_SCORE_LIMIT)
  }
}
