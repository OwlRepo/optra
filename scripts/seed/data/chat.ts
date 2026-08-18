// Six chat sessions belonging to the demo user.
//
// Assistant messages carry a real `sources` array wired to the seeded document
// and ticket ids, so the citation pills in the UI resolve to rows that actually
// exist. Sessions are filtered by workspaceId AND userId in ChatService, so
// they must belong to the demo user to be visible after login.
import { DEMO_USER_ID, DEMO_WORKSPACE_ID, daysAgo, minutesAfter } from '../config'
import { seedDocuments } from './documents'
import { seedTickets } from './tickets'

function docBySlug(slug: string) {
  const doc = seedDocuments.find(d => d.sourceUrl.endsWith(`/${slug}`))
  if (!doc) throw new Error(`seed chat references unknown document slug: ${slug}`)
  return doc
}

function ticketByIndex(n: number) {
  const ticket = seedTickets[n - 1]
  if (!ticket) throw new Error(`seed chat references unknown ticket #${n}`)
  return ticket
}

function docSource(slug: string, score: number, snippet: string) {
  const doc = docBySlug(slug)
  return {
    sourceType: 'document' as const,
    documentId: doc.id,
    knowledgeBaseId: doc.knowledgeBaseId,
    title: doc.title,
    sourceUrl: doc.sourceUrl,
    score,
    snippet,
  }
}

function ticketSource(n: number, score: number, snippet: string) {
  const ticket = ticketByIndex(n)
  return {
    sourceType: 'ticket' as const,
    ticketId: ticket.id,
    title: ticket.title ?? 'Untitled ticket',
    score,
    snippet,
  }
}

interface Turn {
  question: string
  answer: string
  sources: (ReturnType<typeof docSource> | ReturnType<typeof ticketSource>)[]
}

interface SessionSpec {
  id: string
  title: string
  ageDays: number
  turns: Turn[]
}

const SESSIONS: SessionSpec[] = [
  {
    id: 'f0000000-0000-4000-8000-000000000001',
    title: 'Exporting a client timesheet',
    ageDays: 1,
    turns: [
      {
        question: 'How do I export a timesheet to CSV?',
        answer:
          'Open Timesheets, select the week or date range, then choose Export → CSV from the toolbar. The file has one row per time entry with the columns Date, Member, Project, Task, Billable, Hours and Notes, and it respects whichever filters are active at the time. Ranges up to 90 days are generated immediately; longer ranges are queued and emailed to you as a download link. Note that the Hours column uses your workspace rounding rule rather than the raw stopwatch value.',
        sources: [
          docSource(
            'exporting-timesheets',
            0.91,
            'To export a timesheet to CSV, open Timesheets, pick the week or date range you want, then choose Export → CSV from the toolbar.',
          ),
          docSource('rounding-rules', 0.74, 'Rounding is applied per entry, not per day.'),
        ],
      },
      {
        question: 'Is there a size limit?',
        answer:
          'Yes — a single export is capped at 50,000 rows. Above that you need to split the range or filter by project. Download links stay valid for 7 days, and only Managers and Owners can export workspace-wide data; a Member can only export their own entries. Worth knowing: exports that hit the cap have historically failed without notifying the requester, so if a large export never arrives, that is the first thing to check.',
        sources: [
          docSource(
            'exporting-timesheets',
            0.88,
            'A single export is capped at 50,000 rows; if you exceed it, split the range or filter by project.',
          ),
          ticketSource(11, 0.69, 'A six-month export exceeded the 50,000-row cap and failed without any email.'),
        ],
      },
    ],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000002',
    title: 'QuickBooks sync keeps failing',
    ageDays: 3,
    turns: [
      {
        question: 'Why would QuickBooks sync stop working?',
        answer:
          'There are three common causes. The OAuth refresh token can be invalidated — this happens when the QuickBooks admin who authorized the connection is removed or changed, and only the workspace owner reconnecting from Settings → Integrations fixes it. A customer name collision will fail the sync until the duplicate is resolved in QuickBooks. Finally, QuickBooks itself rate-limits at 500 requests per minute per realm, which resolves on its own within the hour. After 24 hours of failed retries the integration is marked degraded and the owner is emailed.',
        sources: [
          docSource(
            'runbook-quickbooks-sync',
            0.93,
            'Sync failures are almost always one of three things: an expired OAuth refresh token, a QuickBooks customer name collision, or QuickBooks rate-limiting.',
          ),
          docSource(
            'invoicing-quickbooks',
            0.81,
            'Sync failures are retried with exponential backoff for 24 hours before the integration is marked degraded.',
          ),
          ticketSource(
            3,
            0.78,
            'The OAuth refresh token was invalidated when the customer rotated their QuickBooks admin user.',
          ),
        ],
      },
      {
        question: 'Can we replay the invoices that failed?',
        answer:
          'Yes. Once the connection is healthy again, use the admin replay tool. Replay is safe to run repeatedly because invoice sync is keyed on our invoice id, so a replayed invoice updates the existing QuickBooks record rather than creating a duplicate.',
        sources: [
          docSource(
            'runbook-quickbooks-sync',
            0.86,
            'Replay the failed invoices with the admin replay tool, which is safe to run repeatedly because invoice sync is keyed on our invoice id.',
          ),
        ],
      },
    ],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000003',
    title: 'Approvals and locked weeks',
    ageDays: 5,
    turns: [
      {
        question: 'A manager approved the wrong week. How do we undo it?',
        answer:
          'An Owner can reopen the week from the week menu, which unlocks the entries and clears the approval. The important caveat: reopening does not touch an invoice that already drew on those hours. Issued invoices are frozen permanently, so you have to credit or edit the invoice separately. Both the reopen and the credit are recorded in the audit log.',
        sources: [
          docSource(
            'timesheet-approvals',
            0.9,
            'Reopening unlocks the entries and clears the approval, but it does not touch any invoice that already drew on those hours.',
          ),
          ticketSource(5, 0.82, 'Reopening a week is intentionally decoupled from invoice state.'),
        ],
      },
      {
        question: 'Can a manager approve their own timesheet?',
        answer:
          'No. A member can never approve their own week, even if they hold the Manager role — another Manager or the Owner has to do it. This is a deliberate separation-of-duties rule.',
        sources: [
          docSource(
            'timesheet-approvals',
            0.94,
            'A member can never approve their own week even if they hold the Manager role.',
          ),
        ],
      },
    ],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000004',
    title: 'SSO lockout postmortem',
    ageDays: 8,
    turns: [
      {
        question: 'What happens if the identity provider is unreachable after we enforce SSO?',
        answer:
          'Members will be unable to sign in, but the Owner can still use password login — enforcement disables passwords for everyone except the Owner precisely so there is a break-glass path. We have seen this in the field: a certificate rotation changed the IdP metadata URL and locked out every member until the owner signed in with a password and updated the URL.',
        sources: [
          docSource(
            'saml-sso',
            0.92,
            'Keeping the Owner on password login is deliberate: it is the break-glass path if the IdP is unreachable.',
          ),
          ticketSource(
            8,
            0.85,
            'All members were locked out after SSO enforcement because the IdP metadata URL changed.',
          ),
        ],
      },
    ],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000005',
    title: 'Missing hours in a report',
    ageDays: 12,
    turns: [
      {
        question: 'A customer says hours are missing from their report. Where do I start?',
        answer:
          'Four causes cover almost all of these. The entry may fall outside the selected range because reports render in the workspace time zone, not the viewer device time zone — an 11pm Manila entry lands on the previous day for a New York workspace. The project may be Restricted and the viewer unassigned. The report may filter to billable only while the entries are non-billable. Or the week was rejected and the entries went back to draft. Check the filters first, then open the member week directly to confirm the entries still exist.',
        sources: [
          docSource(
            'missing-hours',
            0.94,
            'Hours most often go missing from a report for one of four reasons: time zone, restricted project, billable filter, or a rejected week.',
          ),
          ticketSource(2, 0.8, 'Late-evening entries from members in UTC+8 are reported on the previous day.'),
          ticketSource(1, 0.71, 'CSV export returns zero rows for a project that was switched to Restricted.'),
        ],
      },
    ],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000006',
    title: 'Can we recover a deleted workspace?',
    ageDays: 20,
    turns: [
      {
        question: 'A customer deleted their workspace 40 days ago. Can we get it back?',
        answer:
          'No. Workspace deletion is a soft delete for 30 days, and after that the data is purged irreversibly. Point-in-time database backups exist for disaster recovery only and are never used to resurrect a single tenant, because restoring one would roll back every other workspace in the same cluster. Say that plainly rather than implying a maybe. Within the 30-day window it is recoverable from the admin console — and note that restore also re-enables scheduled exports, so warn the customer before a month of digests fires.',
        sources: [
          docSource(
            'data-retention',
            0.89,
            'Deleting a workspace is a soft delete for 30 days, after which all data is purged irreversibly.',
          ),
          docSource('runbook-restore-workspace', 0.87, 'Once purged there is no restore path.'),
          ticketSource(
            23,
            0.76,
            'A customer asked to restore a workspace deleted 40 days earlier; it was purged at day 30.',
          ),
        ],
      },
    ],
  },
]

export function buildChatSessionRows() {
  return SESSIONS.map(session => ({
    id: session.id,
    workspaceId: DEMO_WORKSPACE_ID,
    userId: DEMO_USER_ID,
    title: session.title,
    createdAt: daysAgo(session.ageDays),
    updatedAt: daysAgo(session.ageDays),
  }))
}

export interface SeedChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  sources: unknown[] | null
  createdAt: Date
  /** Set on assistant rows so chat_query_metrics can point at them. */
  question?: string
  topScore?: number
}

export function buildChatMessageRows(): SeedChatMessage[] {
  const rows: SeedChatMessage[] = []
  SESSIONS.forEach((session, sIndex) => {
    const base = daysAgo(session.ageDays)
    session.turns.forEach((turn, tIndex) => {
      const seq = sIndex * 10 + tIndex * 2
      rows.push({
        id: `f1000000-0000-4000-8000-${String(seq + 1).padStart(12, '0')}`,
        sessionId: session.id,
        role: 'user',
        content: turn.question,
        // chat_messages.search_vector is GENERATED ALWAYS — never written here.
        sources: null,
        createdAt: minutesAfter(base, tIndex * 4),
      })
      rows.push({
        id: `f1000000-0000-4000-8000-${String(seq + 2).padStart(12, '0')}`,
        sessionId: session.id,
        role: 'assistant',
        content: turn.answer,
        sources: turn.sources,
        createdAt: minutesAfter(base, tIndex * 4 + 1),
        question: turn.question,
        topScore: Math.max(...turn.sources.map(s => s.score)),
      })
    })
  })
  return rows
}
