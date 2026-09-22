// Workspace activity feed plus the two scrape runs it references.
//
// Covers every workspace_event_type value with staggered timestamps — asserted
// against the enum itself in data.test.ts, not against a copied list.
// workspace_members.events_seen_at is left null for the demo user, so the
// dashboard renders an unread badge over these.
import { workspaceEventTypeEnum } from '@repo/db'
import { DEMO_WORKSPACE_ID, daysAgo } from '../config'
import { seedDocuments } from './documents'
import { seedTickets } from './tickets'
import { buildComparisonRunRows, buildPurchaseOrderRows } from './procurement'

export const SCRAPE_RUN_OK_ID = '90000000-0000-4000-8000-000000000001'
export const SCRAPE_RUN_FAILED_ID = '90000000-0000-4000-8000-000000000002'

// Derived, not copied. The previous hand-written union claimed six values
// under a header that claimed coverage of all of them; widening the enum left
// both quietly wrong.
type EventType = (typeof workspaceEventTypeEnum.enumValues)[number]

export function buildEventRows() {
  const doneDocs = seedDocuments.filter(d => d.status === 'done')
  const failedDoc = seedDocuments.find(d => d.status === 'failed')!
  const doneTickets = seedTickets.filter(t => t.status === 'done')
  const failedTicket = seedTickets.find(t => t.status === 'failed')!

  const rows: {
    workspaceId: string
    type: EventType
    entityId: string
    title: string
    detail: string | null
    createdAt: Date
  }[] = []

  doneDocs.slice(0, 5).forEach((doc, i) => {
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      type: 'document_ingested',
      entityId: doc.id,
      title: doc.title,
      detail: `Indexed ${doc.sections.length} section${doc.sections.length === 1 ? '' : 's'}`,
      createdAt: daysAgo(i + 1, 9),
    })
  })

  rows.push({
    workspaceId: DEMO_WORKSPACE_ID,
    type: 'document_failed',
    entityId: failedDoc.id,
    title: failedDoc.title,
    detail: failedDoc.lastError ?? 'Ingest failed',
    createdAt: daysAgo(2, 15),
  })

  doneTickets.slice(0, 4).forEach((ticket, i) => {
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      type: 'ticket_extracted',
      entityId: ticket.id,
      title: ticket.title ?? 'Ticket extracted',
      detail: `Severity ${ticket.severity} · ${ticket.productArea}`,
      createdAt: daysAgo(i + 1, 13),
    })
  })

  rows.push({
    workspaceId: DEMO_WORKSPACE_ID,
    type: 'ticket_failed',
    entityId: failedTicket.id,
    title: 'Ticket extraction failed',
    detail: failedTicket.lastError ?? 'Extraction failed',
    createdAt: daysAgo(1, 16),
  })

  rows.push({
    workspaceId: DEMO_WORKSPACE_ID,
    type: 'scrape_completed',
    entityId: SCRAPE_RUN_OK_ID,
    title: 'docs.heliolabs.io',
    detail: '31 pages found · 29 indexed · 2 skipped',
    createdAt: daysAgo(6, 8),
  })

  rows.push({
    workspaceId: DEMO_WORKSPACE_ID,
    type: 'scrape_failed',
    entityId: SCRAPE_RUN_FAILED_ID,
    title: 'status.heliolabs.io',
    detail: 'robots.txt disallows /incidents for our crawler user agent',
    createdAt: daysAgo(4, 11),
  })

  // S8 auto-comparison. Both point at a real `comparison_runs` row and agree
  // with its status — a feed that contradicted the history it links to would
  // be the same defect S6 found in the seeded discrepancy flags.
  const runs = buildComparisonRunRows()
  const poNumberOf = new Map(buildPurchaseOrderRows().map(po => [po.id, po.poNumber]))

  const flagged = runs.find(run => run.status === 'succeeded' && (run.flagCount ?? 0) > 0)
  if (flagged) {
    const count = flagged.flagCount ?? 0
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      type: 'comparison_flagged',
      entityId: flagged.id,
      title: poNumberOf.get(flagged.purchaseOrderId) ?? 'Comparison',
      detail: `${count} ${count === 1 ? 'discrepancy' : 'discrepancies'} to review`,
      createdAt: flagged.finishedAt,
    })
  }

  const failed = runs.find(run => run.status === 'failed')
  if (failed) {
    rows.push({
      workspaceId: DEMO_WORKSPACE_ID,
      type: 'comparison_failed',
      entityId: failed.id,
      title: poNumberOf.get(failed.purchaseOrderId) ?? 'Comparison',
      detail: 'Comparison did not finish',
      createdAt: failed.finishedAt,
    })
  }

  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export function buildScrapeRunRows(helpCenterKbId: string) {
  return [
    {
      id: SCRAPE_RUN_OK_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      knowledgeBaseId: helpCenterKbId,
      seedUrl: 'https://docs.heliolabs.io/',
      status: 'completed' as const,
      queueJobId: 'seed-scrape-1',
      enqueuedAt: daysAgo(6, 7),
      maxDepth: 2,
      maxPages: 50,
      pagesFound: 31,
      pagesSucceeded: 29,
      pagesFailed: 2,
      error: null,
      startedAt: daysAgo(6, 7),
      lastProgressAt: daysAgo(6, 8),
      finishedAt: daysAgo(6, 8),
      createdAt: daysAgo(6, 7),
    },
    {
      id: SCRAPE_RUN_FAILED_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      knowledgeBaseId: helpCenterKbId,
      seedUrl: 'https://status.heliolabs.io/incidents',
      status: 'failed' as const,
      queueJobId: 'seed-scrape-2',
      enqueuedAt: daysAgo(4, 10),
      maxDepth: 1,
      maxPages: 25,
      pagesFound: 0,
      pagesSucceeded: 0,
      pagesFailed: 0,
      error: 'robots.txt disallows /incidents for our crawler user agent',
      startedAt: daysAgo(4, 10),
      lastProgressAt: daysAgo(4, 11),
      finishedAt: daysAgo(4, 11),
      createdAt: daysAgo(4, 10),
    },
  ]
}
