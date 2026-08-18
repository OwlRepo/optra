// Insights V2 surfaces: freshness flags, FAQ drafts, digest settings, the
// background runs that would have produced them, and a couple of saved
// refined messages.
//
// Freshness flags inner-join documents for the title, so document_id must be a
// real seeded document; FAQ drafts carry ticket_ids as provenance, so those
// must be real seeded tickets.
import { DEMO_TEAMMATE_ID, DEMO_USER_ID, DEMO_WORKSPACE_ID, daysAgo } from '../config'
import { seedDocuments } from './documents'
import { indexedTickets, seedTickets } from './tickets'

function docBySlug(slug: string) {
  const doc = seedDocuments.find(d => d.sourceUrl.endsWith(`/${slug}`))
  if (!doc) throw new Error(`insights seed references unknown document slug: ${slug}`)
  return doc
}

export function buildReviewFlagRows() {
  const specs: [string, number, number, string, number][] = [
    [
      'runbook-quickbooks-sync',
      3,
      0.31,
      'Three recent tickets describe an OAuth failure mode (admin rotation revoking the refresh token) that this runbook does not mention.',
      5,
    ],
    [
      'exporting-timesheets',
      11,
      0.28,
      'Tickets about capped exports report no failure notification, but this document implies every export is delivered or emailed.',
      9,
    ],
    [
      'saml-sso',
      8,
      0.34,
      'The IdP metadata rotation lockout in recent tickets is not covered by the SSO enforcement guidance.',
      12,
    ],
    [
      'timers-desktop-app',
      15,
      0.37,
      'The 12-hour confirmation prompt is documented as universal, but mobile does not enforce it.',
      15,
    ],
    [
      'tags',
      21,
      0.39,
      'Tag rename is documented as updating every entry; a ticket shows archived-project entries are skipped.',
      18,
    ],
  ]

  return specs.map(([slug, ticketIndex, score, reason, ageDays]) => ({
    workspaceId: DEMO_WORKSPACE_ID,
    documentId: docBySlug(slug).id,
    ticketId: seedTickets[ticketIndex - 1]!.id,
    score,
    reason,
    status: 'open' as const,
    dismissedAt: null,
    dismissedBy: null,
    createdAt: daysAgo(ageDays),
  }))
}

export function buildFaqDraftRows() {
  const indexed = indexedTickets()
  const pick = (from: number, to: number) => indexed.slice(from, to).map(t => t.id)

  return [
    {
      workspaceId: DEMO_WORKSPACE_ID,
      question: 'Why does my CSV export come back empty?',
      answer:
        'An empty export almost always means a visibility or filter problem rather than missing data. Check whether the project was switched to Restricted and you are not an assigned member, whether the report range is affected by the workspace time zone, and whether a billable-only filter is excluding the entries. Confirm the entries still exist by opening the member week directly before escalating.',
      ticketIds: pick(0, 3),
      clusterSize: 3,
      status: 'pending' as const,
      documentId: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: daysAgo(2),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      question: 'What should I do when QuickBooks sync goes degraded?',
      answer:
        'Check the integration status page for the verbatim QuickBooks error first. An expired refresh token requires the workspace owner to reconnect from Settings → Integrations — support cannot re-authorize on their behalf. Rate limiting resolves itself within the hour. A customer name collision must be fixed in QuickBooks, after which the failed invoices can be replayed safely with the admin replay tool.',
      ticketIds: pick(2, 5),
      clusterSize: 4,
      status: 'pending' as const,
      documentId: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: daysAgo(4),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      question: 'Can an approved timesheet week be reopened after invoicing?',
      answer:
        'Yes, an Owner can reopen the week, but reopening never changes an already-issued invoice — issued invoices are frozen so historical billing stays reproducible. The invoice has to be credited or edited separately, and both actions land in the audit log.',
      ticketIds: pick(4, 7),
      clusterSize: 3,
      status: 'approved' as const,
      documentId: null,
      reviewedBy: DEMO_USER_ID,
      reviewedAt: daysAgo(7),
      createdAt: daysAgo(9),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      question: 'Do we support Slack notifications?',
      answer: 'Not currently. Digest delivery to a Slack webhook is configurable, but per-event notifications are not.',
      ticketIds: pick(0, 2),
      clusterSize: 2,
      status: 'rejected' as const,
      documentId: null,
      reviewedBy: DEMO_TEAMMATE_ID,
      reviewedAt: daysAgo(11),
      createdAt: daysAgo(13),
    },
  ]
}

export function buildDigestSettingsRow() {
  return {
    workspaceId: DEMO_WORKSPACE_ID,
    emailEnabled: true,
    slackWebhookUrl: null,
    slackEnabled: false,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(6),
  }
}

export function buildBackgroundRunRows() {
  return [
    {
      workspaceId: DEMO_WORKSPACE_ID,
      kind: 'freshness-check',
      status: 'succeeded' as const,
      startedAt: daysAgo(1, 3),
      finishedAt: daysAgo(1, 3),
      lastError: null,
      stats: { documentsScanned: 27, flagsCreated: 2 },
      createdAt: daysAgo(1, 3),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      kind: 'faq-draft',
      status: 'succeeded' as const,
      startedAt: daysAgo(2, 4),
      finishedAt: daysAgo(2, 4),
      lastError: null,
      stats: { clustersFound: 6, draftsCreated: 2 },
      createdAt: daysAgo(2, 4),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      kind: 'topic-gap',
      status: 'succeeded' as const,
      startedAt: daysAgo(3, 4),
      finishedAt: daysAgo(3, 4),
      lastError: null,
      stats: { queriesAnalyzed: 312, gapsFound: 4 },
      createdAt: daysAgo(3, 4),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      kind: 'digest',
      status: 'failed' as const,
      startedAt: daysAgo(5, 6),
      finishedAt: daysAgo(5, 6),
      lastError: 'Slack webhook not configured for this workspace',
      stats: null,
      createdAt: daysAgo(5, 6),
    },
  ]
}

export function buildSavedRefinedMessageRows() {
  return [
    {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_USER_ID,
      originalText: 'cant restore ur workspace its gone sorry',
      refinedText:
        'I am sorry to confirm that this workspace cannot be restored. Deletion is a soft delete for 30 days, and past that window the data is permanently purged — our backups are cluster-wide disaster-recovery snapshots, so they cannot be used to bring back a single workspace. I know that is not the answer you were hoping for. If it would help, I can walk you through setting up a mandatory pre-deletion export so this cannot happen again.',
      createdAt: daysAgo(3),
    },
    {
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_USER_ID,
      originalText: 'export empty because project restricted, assign urself',
      refinedText:
        'The export is coming back empty because the Acme project was switched to Restricted on Monday, and restricted projects are hidden from anyone who is not an assigned member — including in exports. Once you add yourself to the project, re-running the same export will include the rows. I have also flagged the confusing empty file to our product team, since it should really be an explicit permissions message.',
      createdAt: daysAgo(6),
    },
  ]
}
