import { Injectable } from '@nestjs/common'
import { and, count, eq, gte } from 'drizzle-orm'
import { db, documentReviewFlags, faqDrafts, tickets, workspaceEvents } from '@repo/db'
import { CoverageDashboardService, type CoverageSummary } from './coverage-dashboard.service'

const DIGEST_WINDOW_DAYS = Number.parseInt(process.env.DIGEST_WINDOW_DAYS ?? '7', 10)

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

    const [events, chatSummary, [freshnessCount], [faqCount], [ticketCount]] = await Promise.all([
      db
        .select({ type: workspaceEvents.type, value: count() })
        .from(workspaceEvents)
        .where(and(eq(workspaceEvents.workspaceId, workspaceId), gte(workspaceEvents.createdAt, since)))
        .groupBy(workspaceEvents.type),
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

    const eventCounts: Record<string, number> = {}
    for (const row of events) {
      eventCounts[row.type] = Number(row.value)
    }

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
}
