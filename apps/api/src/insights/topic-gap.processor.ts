import { Inject, Injectable, Logger } from '@nestjs/common'
import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { sql } from 'drizzle-orm'
import { db } from '@repo/db'
import type Redis from 'ioredis'
import { BackgroundRunsService } from './background-runs.service'
import { FaqClusterService } from './faq-cluster.service'
import { LOW_SCORE_THRESHOLD, topicGapsRedisKey, type TopicGap } from './coverage-dashboard.service'

// V2 F7a: resolves the "gap-cluster labeling cost cap" open point with two
// caps — MAX_CANDIDATE_QUERIES bounds how many rows get pulled/clustered per
// run, MAX_LABELED_CLUSTERS bounds how many LLM label calls happen per run
// (only the largest clusters, i.e. the most-repeated gaps, get labeled).
const LOOKBACK_DAYS = Number.parseInt(process.env.TOPIC_GAP_LOOKBACK_DAYS ?? '30', 10)
const MAX_CANDIDATE_QUERIES = Number.parseInt(process.env.TOPIC_GAP_MAX_CANDIDATES ?? '200', 10)
const MAX_LABELED_CLUSTERS = Number.parseInt(process.env.TOPIC_GAP_MAX_LABELED_CLUSTERS ?? '5', 10)
const REDIS_TTL_SECONDS = 9 * 24 * 60 * 60 // 9 days — outlives the weekly cadence by a day

@Injectable()
@Processor('topic-gap-queue')
export class TopicGapProcessor {
  private readonly logger = new Logger(TopicGapProcessor.name)

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly clusterer: FaqClusterService,
    private readonly runs: BackgroundRunsService,
  ) {}

  @Process()
  async onGap(job: Job<{ workspaceId: string }>) {
    const { workspaceId } = job.data
    const runId = await this.runs.start('topic-gap', workspaceId)

    try {
      const candidates = await this.fetchCandidates(workspaceId)
      const clusters = this.clusterer.cluster(
        candidates.map((row) => ({ ticketId: row.id, embedding: row.embedding, score: 0 })),
      )

      const byId = new Map(candidates.map((row) => [row.id, row.question]))
      const ranked = [...clusters].sort((a, b) => b.length - a.length).slice(0, MAX_LABELED_CLUSTERS)

      const gaps: TopicGap[] = []
      for (const cluster of ranked) {
        const questions = cluster.map((id) => byId.get(id)!).filter(Boolean)
        const { generateTopicLabel } = await import('@repo/ai')
        const label = await generateTopicLabel(questions)
        gaps.push({ label, questionCount: cluster.length, exampleQuestion: questions[0] })
      }

      await this.redis.set(topicGapsRedisKey(workspaceId), JSON.stringify(gaps), 'EX', REDIS_TTL_SECONDS)
      await this.runs.succeed(runId, { candidateCount: candidates.length, clustersFound: clusters.length, gapsLabeled: gaps.length })
      this.logger.log(`Topic gap workspaceId=${workspaceId} gapsLabeled=${gaps.length}`)
    } catch (error) {
      await this.runs.fail(runId, error)
      this.logger.error(
        `Topic gap failed workspaceId=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }

  private async fetchCandidates(workspaceId: string): Promise<{ id: string; question: string; embedding: number[] }[]> {
    const result = await db.execute<{ id: string; question: string; embedding: string }>(sql`
      SELECT id, question, question_embedding::text AS embedding
      FROM chat_query_metrics
      WHERE workspace_id = ${workspaceId}::uuid
        AND question_embedding IS NOT NULL
        AND (is_fallback OR top_score < ${LOW_SCORE_THRESHOLD})
        AND created_at >= now() - make_interval(days => ${LOOKBACK_DAYS})
      ORDER BY created_at DESC
      LIMIT ${MAX_CANDIDATE_QUERIES}
    `)

    return result.rows.map((row) => ({
      id: row.id,
      question: row.question,
      embedding: JSON.parse(row.embedding) as number[],
    }))
  }
}
