import { Injectable } from '@nestjs/common'
import { db } from '@repo/db'
import { sql } from 'drizzle-orm'

export interface CoverageGap {
  documentId: string
  ticketId: string
  score: number
}

// V2 shared primitive (serves F3, F4): per qualifying ticket-derived chunk,
// the nearest document-derived chunk's cosine score within the SAME
// workspace. A low score means recent ticket content has no good documented
// match — the doc may be stale or missing the topic entirely. Cheap-first by
// design (embedding-distance heuristic, zero LLM calls) per this batch's
// established cost discipline — the plan explicitly left LLM-compare as a
// fallback posture, not the v1 default.
const LOOKBACK_DAYS = Number.parseInt(process.env.FRESHNESS_LOOKBACK_DAYS ?? '90', 10)
const MIN_COVERAGE_SCORE = Number.parseFloat(process.env.FRESHNESS_MIN_SCORE ?? '0.5')

@Injectable()
export class TicketDocCoverageService {
  // Only reviewed+useful+done tickets have chunks at all (syncTicketChunk),
  // so this — like the rest of the ticket-chunk surface — only ever sees
  // that reviewed subset; widening is a separate cost decision, not silent.
  async findGaps(workspaceId: string): Promise<CoverageGap[]> {
    const result = await db.execute<{ documentId: string; ticketId: string; score: number }>(sql`
      SELECT
        nearest.document_id AS "documentId",
        tc.ticket_id AS "ticketId",
        nearest.score AS score
      FROM chunks tc
      CROSS JOIN LATERAL (
        SELECT dc.document_id, 1 - (dc.embedding <=> tc.embedding) AS score
        FROM chunks dc
        WHERE dc.workspace_id = tc.workspace_id
          AND dc.document_id IS NOT NULL
          AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> tc.embedding
        LIMIT 1
      ) nearest
      WHERE tc.workspace_id = ${workspaceId}::uuid
        AND tc.ticket_id IS NOT NULL
        AND tc.embedding IS NOT NULL
        AND tc.created_at >= now() - make_interval(days => ${LOOKBACK_DAYS})
        AND nearest.score < ${MIN_COVERAGE_SCORE}
        AND NOT EXISTS (
          SELECT 1 FROM document_review_flags f
          WHERE f.document_id = nearest.document_id
            AND f.ticket_id = tc.ticket_id
            AND f.status = 'open'
        )
    `)

    return result.rows
  }
}
