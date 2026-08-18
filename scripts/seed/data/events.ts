// Workspace activity feed plus the two scrape runs it references.
//
// Covers all six workspace_event_type values with staggered timestamps.
// workspace_members.events_seen_at is left null for the demo user, so the
// dashboard renders an unread badge over these.
import { DEMO_WORKSPACE_ID, daysAgo } from '../config'
import { seedDocuments } from './documents'
import { seedTickets } from './tickets'

export const SCRAPE_RUN_OK_ID = '90000000-0000-4000-8000-000000000001'
export const SCRAPE_RUN_FAILED_ID = '90000000-0000-4000-8000-000000000002'

type EventType =
  | 'document_ingested'
  | 'document_failed'
  | 'scrape_completed'
  | 'scrape_failed'
  | 'ticket_extracted'
  | 'ticket_failed'

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
