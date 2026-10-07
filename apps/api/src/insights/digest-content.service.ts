import { Injectable } from '@nestjs/common'
import { and, count, eq, gte, inArray } from 'drizzle-orm'
import { db, documentReviewFlags, faqDrafts, tickets, workspaceEvents, type WorkspaceEvent } from '@repo/db'
import { CoverageDashboardService, type CoverageSummary } from './coverage-dashboard.service'
import { supportSurfacesEnabled } from './support-surfaces-flag'

const DIGEST_WINDOW_DAYS = Number.parseInt(process.env.DIGEST_WINDOW_DAYS ?? '7', 10)

// While the support surfaces are off, the digest reports procurement comparison
// outcomes only; every other event type belongs to a hidden page.
const PROCUREMENT_EVENT_TYPES: readonly WorkspaceEvent['type'][] = ['comparison_flagged', 'comparison_failed']

const NO_CHAT_SUMMARY: CoverageSummary = { totalQueries: 0, fallbackRate: 0, cacheHitRate: 0, avgTopScore: null }

export interface DigestContent {
  workspaceId: string
  windowDays: number
  eventCounts: Record<string, number>
  chatSummary: CoverageSummary
  newFreshnessFlags: number
  newFaqDrafts: number
  newTickets: number
}

@Injectable()
export class DigestContentService {
  constructor(private readonly coverageDashboard: CoverageDashboardService) {}

  async build(workspaceId: string): Promise<DigestContent> {
    const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    // Same shape either way, so the renderers and the "quiet week" rule need
    // no flag of their own; the hidden surfaces' reads are skipped, not zeroed
    // after the fact.
    if (!supportSurfacesEnabled()) {
      return {
        workspaceId,
        windowDays: DIGEST_WINDOW_DAYS,
        eventCounts: await this.countEvents(workspaceId, since, PROCUREMENT_EVENT_TYPES),
        chatSummary: NO_CHAT_SUMMARY,
        newFreshnessFlags: 0,
        newFaqDrafts: 0,
        newTickets: 0,
      }
    }

    const [eventCounts, chatSummary, [freshnessCount], [faqCount], [ticketCount]] = await Promise.all([
      this.countEvents(workspaceId, since),
      this.coverageDashboard.getSummary(workspaceId),
      db
        .select({ value: count() })
        .from(documentReviewFlags)
        .where(and(eq(documentReviewFlags.workspaceId, workspaceId), gte(documentReviewFlags.createdAt, since))),
      db
        .select({ value: count() })
        .from(faqDrafts)
        .where(and(eq(faqDrafts.workspaceId, workspaceId), gte(faqDrafts.createdAt, since))),
      db
        .select({ value: count() })
        .from(tickets)
        .where(and(eq(tickets.workspaceId, workspaceId), gte(tickets.createdAt, since))),
    ])

    return {
      workspaceId,
      windowDays: DIGEST_WINDOW_DAYS,
      eventCounts,
      chatSummary,
      newFreshnessFlags: Number(freshnessCount?.value ?? 0),
      newFaqDrafts: Number(faqCount?.value ?? 0),
      newTickets: Number(ticketCount?.value ?? 0),
    }
  }

  private async countEvents(
    workspaceId: string,
    since: Date,
    types?: readonly WorkspaceEvent['type'][],
  ): Promise<Record<string, number>> {
    const rows = await db
      .select({ type: workspaceEvents.type, value: count() })
      .from(workspaceEvents)
      .where(
        and(
          eq(workspaceEvents.workspaceId, workspaceId),
          gte(workspaceEvents.createdAt, since),
          types ? inArray(workspaceEvents.type, [...types]) : undefined,
        ),
      )
      .groupBy(workspaceEvents.type)

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.type] = Number(row.value)
    }
    return counts
  }
}
