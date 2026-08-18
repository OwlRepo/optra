// The demo corpus: 28 documents for "Helio Labs", a fictional time-tracking
// SaaS, spread across three knowledge bases.
//
// The prose is real prose, not lorem ipsum, because the whole point of the
// seeder is that chat can answer a question live during a demo and cite the
// right source. Each `section` becomes one row in `chunks` with a real
// embedding, mirroring what the ingest pipeline would have produced.
import {
  DEMO_WORKSPACE_ID,
  KB_HELP_CENTER_ID,
  KB_PRODUCT_DOCS_ID,
  KB_RUNBOOKS_ID,
  daysAgo,
} from '../config'
import { EXTRA_SPECS } from './documents-extra'

export interface SeedSection {
  sectionId: string
  sectionTitle: string
  content: string
}

export interface SeedDocument {
  id: string
  knowledgeBaseId: string
  title: string
  sourceUrl: string
  docType: 'md' | 'pdf' | 'html' | 'docx'
  sourceType: 'document' | 'web'
  status: 'done' | 'processing' | 'failed'
  lastError?: string
  ageDays: number
  sections: SeedSection[]
}

function docId(n: number): string {
  return `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

export interface DocSpec {
  kb: string
  title: string
  slug: string
  docType: SeedDocument['docType']
  sourceType?: SeedDocument['sourceType']
  status?: SeedDocument['status']
  lastError?: string
  ageDays: number
  sections: [string, string][]
}

const SPECS: DocSpec[] = [
  // ---------------------------------------------------------------- Product Docs
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Exporting timesheets',
    slug: 'exporting-timesheets',
    docType: 'md',
    ageDays: 14,
    sections: [
      [
        'Export a timesheet to CSV',
        'To export a timesheet to CSV, open Timesheets, pick the week or date range you want, then choose Export → CSV from the toolbar. The export includes one row per time entry with the columns Date, Member, Project, Task, Billable, Hours, and Notes. Exports respect whatever filters are active, so if you have filtered to a single project you will only get that project. CSV files are generated synchronously for ranges up to 90 days; anything longer is queued and emailed to you as a download link when it finishes. Exported hours are always rounded using the workspace rounding rule, not the raw stopwatch value.',
      ],
      [
        'Export formats and limits',
        'Helio Labs supports three export formats: CSV for spreadsheets, XLSX when you need multiple sheets (one per project), and PDF for client-ready summaries. XLSX and PDF exports are always queued and delivered by email. A single export is capped at 50,000 rows; if you exceed it, split the range or filter by project. Download links expire after 7 days, after which you simply re-run the export. Only members with the Manager or Owner role can export data for the whole workspace — a regular Member can export only their own entries.',
      ],
      [
        'Scheduled exports',
        'Managers can schedule a recurring export from Settings → Exports. Choose a cadence (weekly on a chosen weekday, or monthly on a chosen day), a format, and up to five recipient email addresses. Scheduled exports run at 06:00 in the workspace time zone and are skipped silently if the range contains no entries. Changing the workspace time zone does not retroactively change the timestamps of past exports. If a scheduled export fails three times in a row it is paused automatically and the workspace owner is notified.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Time entry rounding rules',
    slug: 'rounding-rules',
    docType: 'md',
    ageDays: 21,
    sections: [
      [
        'How rounding works',
        'Every workspace has a single rounding rule that applies to reporting and export, never to the stored entry. The raw duration is always kept to the second, so you can change the rule later and every historical report re-renders with the new rule. Options are: no rounding, nearest 5 / 6 / 10 / 15 / 30 minutes, always round up, and always round down. Rounding is applied per entry, not per day, which is why a day of six 7-minute entries under "nearest 15" reports as 1h 30m rather than 45m.',
      ],
      [
        'Rounding and billable totals',
        'Invoicing uses rounded hours, so changing the rounding rule changes what your clients are billed for periods that have not yet been invoiced. Already-issued invoices are frozen and never recalculated. If you need a different rule for one client, set a project-level override from Project Settings → Billing; a project override wins over the workspace rule. Overrides are audited: the change, the actor and the timestamp appear in the project activity log.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Timesheet approvals',
    slug: 'timesheet-approvals',
    docType: 'md',
    ageDays: 30,
    sections: [
      [
        'Submitting a timesheet',
        'When approvals are enabled, a member submits a week from the Timesheets screen. Submission locks every entry in that week: they become read-only and can no longer be edited, deleted, or moved to another project. A submitted week shows the status Pending. Members can withdraw a submission themselves as long as no approver has acted on it yet.',
      ],
      [
        'Approving and rejecting',
        'Approvers see a queue at Timesheets → Approvals. Approving a week marks every entry Approved and makes them eligible for invoicing. Rejecting requires a comment, unlocks the week, and returns it to the member with the comment attached. A week can be re-submitted any number of times. Only Managers and Owners can approve, and a member can never approve their own week even if they hold the Manager role.',
      ],
      [
        'Reopening an approved week',
        'Owners can reopen an approved week from the week menu. Reopening unlocks the entries and clears the approval, but it does not touch any invoice that already drew on those hours — you must credit or edit the invoice separately. Reopening is recorded in the workspace audit log with the actor and reason.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Projects, clients and tasks',
    slug: 'projects-clients-tasks',
    docType: 'md',
    ageDays: 45,
    sections: [
      [
        'The project hierarchy',
        'Helio Labs models work as Client → Project → Task. A client is a billing entity; a project belongs to exactly one client; a task belongs to exactly one project. Time entries always attach to a task, and the project and client are derived from it. Archiving a client archives all of its projects, which hides them from pickers without deleting any historical time. Archived projects still appear in reports for date ranges when they were active.',
      ],
      [
        'Billable defaults and rates',
        'Each project carries a default billable flag and an hourly rate. A task can override the rate, and a member can carry a personal rate that overrides both — the precedence is member rate, then task rate, then project rate. Changing a rate never rewrites historical entries; each entry stores the rate that was in effect when it was created, which is what keeps old invoices reproducible.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Timers and the desktop app',
    slug: 'timers-desktop-app',
    docType: 'md',
    ageDays: 28,
    sections: [
      [
        'Running a timer',
        'A member can have exactly one timer running at a time. Starting a second timer stops the first and saves it as a completed entry. Timers survive a browser refresh because the start time is stored server-side, not in local storage. If a timer has been running for more than 12 hours, Helio Labs prompts you to confirm before saving, which catches the classic "left it running over the weekend" case.',
      ],
      [
        'Offline capture',
        'The macOS and Windows desktop apps queue entries locally when the network is unavailable and sync when it returns. Conflicts are resolved last-write-wins on the entry id, and any entry that lands in a week that has already been approved is rejected and surfaced in the app as a sync error rather than silently dropped.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Reports and dashboards',
    slug: 'reports-dashboards',
    docType: 'md',
    ageDays: 35,
    sections: [
      [
        'Building a report',
        'Reports are built from three choices: a date range, a grouping (member, project, client, task, or day), and optional filters for billable state and tags. Every report can be saved and shared with a link that respects the viewer permissions — a Member opening a shared workspace-wide report sees only the rows they are allowed to see, so links are safe to paste into a channel.',
      ],
      [
        'Utilization',
        'Utilization is billable hours divided by capacity, where capacity comes from each member profile and defaults to 40 hours a week. Members with zero capacity are excluded from the average rather than counted as zero, which is the most common source of "our utilization looks wrong" tickets.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Invoicing and QuickBooks sync',
    slug: 'invoicing-quickbooks',
    docType: 'md',
    ageDays: 40,
    sections: [
      [
        'Generating an invoice',
        'Invoices draw from approved, billable, un-invoiced time for a single client. Generating one marks those entries as invoiced so they can never be double-billed. Draft invoices can be edited freely; issuing an invoice freezes its line items permanently. Voiding an invoice releases its entries back to the un-invoiced pool.',
      ],
      [
        'QuickBooks Online sync',
        'Connect QuickBooks from Settings → Integrations. Issued invoices sync one way, from Helio Labs to QuickBooks, every 15 minutes. Client records are matched by exact name first and by email second; if neither matches, a new QuickBooks customer is created. Sync failures are retried with exponential backoff for 24 hours before the integration is marked degraded and the owner is emailed.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Roles and permissions',
    slug: 'roles-permissions',
    docType: 'md',
    ageDays: 60,
    sections: [
      [
        'The three roles',
        'Helio Labs has three roles. Owner can do everything including billing and deleting the workspace. Manager can manage projects, approve timesheets, invoice, and see all members data. Member can log time, see their own entries and reports, and see projects they are assigned to. There is exactly one Owner per workspace; transferring ownership is done from Settings → Members and requires the new owner to accept.',
      ],
      [
        'Project-level access',
        'Projects can be Open (any member can log time to them) or Restricted (only assigned members). Restricted projects are hidden entirely from unassigned members, including in reports and search. Making a project restricted does not remove existing entries logged by members who are now unassigned; those hours remain in reports for managers.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'API and webhooks',
    slug: 'api-webhooks',
    docType: 'md',
    ageDays: 25,
    sections: [
      [
        'Authentication and rate limits',
        'The REST API is at https://api.heliolabs.io/v1 and authenticates with a workspace API key sent as a Bearer token. Keys are scoped read-only or read-write and can be rotated without downtime because two keys can be live at once. Rate limits are 120 requests per minute per key, returned in the X-RateLimit-Remaining header; exceeding the limit returns 429 with a Retry-After header, and clients are expected to honour it.',
      ],
      [
        'Webhooks',
        'Webhooks fire for time_entry.created, time_entry.updated, timesheet.submitted, timesheet.approved and invoice.issued. Each delivery is signed with an HMAC-SHA256 signature in the X-Helio-Signature header, computed over the raw body with your endpoint secret — always verify it before trusting a payload. Failed deliveries retry six times over roughly 12 hours; after that the endpoint is disabled and the owner is notified.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Single sign-on (SAML)',
    slug: 'saml-sso',
    docType: 'md',
    ageDays: 55,
    sections: [
      [
        'Configuring SAML',
        'SAML SSO is available on the Business plan. From Settings → Security, paste your identity provider metadata URL, then map the email and name attributes. Helio Labs uses the email attribute as the unique identifier, so changing a user email in the IdP creates a new Helio Labs user rather than renaming the existing one — rename inside Helio Labs first, then in the IdP.',
      ],
      [
        'Enforcing SSO',
        'Once SSO is verified you can enforce it, which disables password login for everyone except the Owner. Keeping the Owner on password login is deliberate: it is the break-glass path if the IdP is unreachable. Just-in-time provisioning creates new members with the Member role; it never grants Manager or Owner.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Mobile app guide',
    slug: 'mobile-app',
    docType: 'md',
    ageDays: 18,
    sections: [
      [
        'Logging time on mobile',
        'The iOS and Android apps support starting and stopping timers, editing today and yesterday entries, and submitting a week for approval. Editing entries older than two days is intentionally desktop-only to reduce accidental changes from a pocket. Push notifications cover approval decisions and reminders to submit on the day your week closes.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Data retention and deletion',
    slug: 'data-retention',
    docType: 'md',
    ageDays: 70,
    sections: [
      [
        'What we keep',
        'Time entries, invoices and audit logs are retained for the life of the workspace. Deleting a member does not delete their time; entries are reassigned to a placeholder "Removed member" so reports and invoices stay correct. Deleting a workspace is a soft delete for 30 days, after which all data is purged irreversibly.',
      ],
      [
        'Export before deletion',
        'Before deleting a workspace, run a full export from Settings → Data. This produces a single ZIP containing CSVs for entries, projects, clients, members and invoices, plus PDF copies of every issued invoice. The ZIP link is valid for 14 days. Support cannot recover a purged workspace, so treat the export as mandatory.',
      ],
    ],
  },

  // ---------------------------------------------------------------- Help Center
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Why are my hours missing from a report?',
    slug: 'missing-hours',
    docType: 'html',
    sourceType: 'web',
    ageDays: 12,
    sections: [
      [
        'Common causes',
        'Hours most often go missing from a report for one of four reasons: the entry is outside the selected date range because of a time-zone difference, the project is Restricted and you are not assigned to it, the entries are non-billable while the report filters to billable only, or the week was rejected and the entries were moved back to draft. Check the report filters first, then open the member week directly to confirm the entries still exist.',
      ],
      [
        'Time zones',
        'Reports use the workspace time zone, not your device time zone. An entry logged at 11pm in Manila appears on the previous day for a workspace set to New York. Change the workspace time zone from Settings → General; the change is display-only and never rewrites stored timestamps.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'How do I reset my password?',
    slug: 'reset-password',
    docType: 'html',
    sourceType: 'web',
    ageDays: 65,
    sections: [
      [
        'Resetting',
        'Choose "Forgot password" on the sign-in screen and enter your email. The reset link is valid for 60 minutes and can be used once. If your workspace enforces SSO, password reset is disabled for everyone except the Owner and the link will not be sent — sign in through your identity provider instead.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Fixing a duplicate time entry',
    slug: 'duplicate-entry',
    docType: 'html',
    sourceType: 'web',
    ageDays: 9,
    sections: [
      [
        'Deleting the duplicate',
        'Open the day in Timesheets, hover the duplicate row and choose Delete. If the week is already submitted you must withdraw the submission first, or ask a Manager to reject it. Duplicates most commonly come from the desktop app syncing an offline queue twice after a long outage; if you see more than a handful, report it rather than deleting them one by one.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Inviting a teammate',
    slug: 'inviting-teammate',
    docType: 'html',
    sourceType: 'web',
    ageDays: 50,
    sections: [
      [
        'Sending an invite',
        'Managers and Owners can invite from Settings → Members → Invite. Invitations expire after 7 days and can be resent, which invalidates the previous link. Seats are billed from the moment an invitation is accepted, not when it is sent. Removing a member frees the seat at the end of the current billing period.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Changing your workspace plan',
    slug: 'changing-plan',
    docType: 'html',
    sourceType: 'web',
    ageDays: 48,
    sections: [
      [
        'Upgrades and downgrades',
        'Upgrades take effect immediately and are prorated for the remainder of the billing period. Downgrades take effect at the end of the period so you keep what you paid for. Downgrading from Business disables SAML SSO and scheduled exports at the switchover; if SSO enforcement is on, turn it off first or members will be unable to sign in.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Understanding billable vs non-billable',
    slug: 'billable-vs-non-billable',
    docType: 'html',
    sourceType: 'web',
    ageDays: 33,
    sections: [
      [
        'Setting the flag',
        'Billable is a per-entry flag that defaults from the project. Internal work such as team meetings should live on a non-billable internal project so it still counts toward capacity but never reaches an invoice. Changing a project default does not retroactively change existing entries — that is deliberate, because it would silently change what clients owe.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Submitting time on behalf of someone else',
    slug: 'time-on-behalf',
    docType: 'html',
    sourceType: 'web',
    ageDays: 22,
    sections: [
      [
        'Manager entry',
        'Managers can add or edit time for any member from the member week view. Every such change is attributed in the audit log to the manager who made it, with the affected member recorded separately, so approvals stay defensible. Managers cannot submit a week on a member behalf; submission is always the member own action.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Tags and how to use them',
    slug: 'tags',
    docType: 'html',
    sourceType: 'web',
    ageDays: 41,
    sections: [
      [
        'Tagging entries',
        'Tags are free-form labels on a time entry, useful for cross-cutting slices like "overtime" or "travel" that do not deserve their own project. An entry can carry up to five tags. Tags are workspace-wide, can be renamed in place, and renaming updates every entry that uses them. Deleting a tag removes it from entries but never deletes the entries themselves.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Weekly reminder emails',
    slug: 'weekly-reminders',
    docType: 'html',
    sourceType: 'web',
    ageDays: 27,
    sections: [
      [
        'Configuring reminders',
        'Reminders nudge members who have logged fewer hours than their capacity by the end of the week. Configure the day, the hour and the threshold from Settings → Notifications. Reminders are skipped for members on approved leave and for anyone who has already submitted. Each member can opt out individually from their own profile.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Importing time from a spreadsheet',
    slug: 'importing-spreadsheet',
    docType: 'html',
    sourceType: 'web',
    status: 'processing',
    ageDays: 0,
    sections: [
      [
        'CSV import format',
        'The importer accepts a CSV with the columns Date, Email, Project, Task, Hours, Billable and Notes. Rows referencing a project or task that does not exist are rejected with a line number so you can fix and re-upload. Imports are all-or-nothing: if any row fails, nothing is written.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Contacting support',
    slug: 'contacting-support',
    docType: 'html',
    sourceType: 'web',
    ageDays: 80,
    sections: [
      [
        'How to reach us',
        'Support is available Monday to Friday, 9am to 6pm UTC, at support@heliolabs.io or from the in-app chat. Business plan workspaces have a four-hour first-response target. When reporting a bug, include the workspace name, the affected member email, and the date range involved — that trio resolves most reports without a follow-up round trip.',
      ],
    ],
  },

  // ---------------------------------------------------------------- Runbooks
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: export queue backlog',
    slug: 'runbook-export-backlog',
    docType: 'md',
    ageDays: 16,
    sections: [
      [
        'Symptoms and first checks',
        'Alert exports_queue_depth fires when more than 500 jobs are waiting for over ten minutes. First check the worker pod count and the Redis connection; a backlog with healthy workers almost always means one very large export is holding a worker. Find it with the queue inspector and note its row count before acting.',
      ],
      [
        'Mitigation',
        'Scale the export workers from 4 to 12 replicas, which is safe up to 16 before the database connection pool becomes the bottleneck. If a single export above 200,000 rows is blocking, cancel it and tell the customer to split the range — cancelling is safe because exports are idempotent and write nothing until they complete. Scale back once depth is under 50.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: QuickBooks sync failures',
    slug: 'runbook-quickbooks-sync',
    docType: 'md',
    ageDays: 11,
    sections: [
      [
        'Diagnosing',
        'Sync failures are almost always one of three things: an expired OAuth refresh token, a QuickBooks customer name collision, or QuickBooks itself rate-limiting us at 500 requests per minute per realm. Check the integration status page first; a degraded integration shows the last error verbatim from the QuickBooks API.',
      ],
      [
        'Recovery',
        'For expired tokens, ask the workspace owner to reconnect from Settings → Integrations; we cannot refresh on their behalf. For rate limiting, no action is needed — the backoff resolves it within the hour. For name collisions, resolve the duplicate in QuickBooks, then replay the failed invoices with the admin replay tool, which is safe to run repeatedly because invoice sync is keyed on our invoice id.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: timer drift after deploy',
    slug: 'runbook-timer-drift',
    docType: 'md',
    ageDays: 7,
    sections: [
      [
        'Background',
        'Running timers are stored as a start timestamp plus a server clock reference. A deploy that rolls pods across hosts with unsynchronized clocks can make a running timer appear to jump. Confirm with the clock skew dashboard before assuming an application bug.',
      ],
      [
        'Fix',
        'Restart chronyd on the affected node and let the pods reschedule. Timers self-correct on the next heartbeat because the duration is recomputed from the stored start time, not accumulated client-side. No data repair is needed unless a timer was stopped during the skew window, in which case correct those entries manually from the admin tool and note it in the incident.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: restoring a deleted workspace',
    slug: 'runbook-restore-workspace',
    docType: 'md',
    ageDays: 38,
    sections: [
      [
        'Within the 30-day window',
        'A soft-deleted workspace can be restored from the admin console by clearing the deleted_at column and re-enabling the billing subscription. Restore also re-enables scheduled exports, which will fire on their normal cadence — warn the customer so a month of digests does not surprise them.',
      ],
      [
        'After purge',
        'Once purged there is no restore path. Point-in-time database backups exist for disaster recovery only and are never used to resurrect a single tenant, because doing so would roll back every other workspace in the same cluster. Say this plainly to the customer rather than implying a maybe.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: webhook endpoint disabled',
    slug: 'runbook-webhook-disabled',
    docType: 'md',
    status: 'failed',
    lastError:
      'Ingest failed: unsupported content type "application/octet-stream" for storage key runbooks/webhook-disabled.md',
    ageDays: 2,
    sections: [],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'On-call escalation policy',
    slug: 'oncall-escalation',
    docType: 'pdf',
    ageDays: 58,
    sections: [
      [
        'Escalation ladder',
        'Primary on-call acknowledges within 5 minutes. Unacknowledged pages escalate to secondary after 10 minutes and to the engineering manager after 20. Any incident touching billing, invoicing or data deletion is a Sev-1 by definition regardless of how few customers are affected, because those are the failures customers never forgive.',
      ],
    ],
  },
]

// EXTRA_SPECS lives in its own module only to keep each file readable; the two
// halves are otherwise identical in shape and treated the same downstream.
const ALL_SPECS: DocSpec[] = [...SPECS, ...EXTRA_SPECS]

export const seedDocuments: SeedDocument[] = ALL_SPECS.map((spec, index) => ({
  id: docId(index + 1),
  knowledgeBaseId: spec.kb,
  title: spec.title,
  sourceUrl: `https://docs.heliolabs.io/${spec.slug}`,
  docType: spec.docType,
  sourceType: spec.sourceType ?? 'document',
  status: spec.status ?? 'done',
  lastError: spec.lastError,
  ageDays: spec.ageDays,
  sections: spec.sections.map(([sectionTitle, content], n) => ({
    sectionId: `${spec.slug}-s${n + 1}`,
    sectionTitle,
    content,
  })),
}))

/** Rows for the `documents` table. */
export function buildDocumentRows() {
  return seedDocuments.map(doc => ({
    id: doc.id,
    workspaceId: DEMO_WORKSPACE_ID,
    knowledgeBaseId: doc.knowledgeBaseId,
    title: doc.title,
    sourceUrl: doc.sourceUrl,
    // Deliberately null: the documents download route streams from S3 via
    // storage.getBuffer(storageKey), so a fabricated key would 500. With a
    // sourceUrl and no storageKey the row renders and links out cleanly.
    storageKey: null,
    contentHash: doc.status === 'done' ? hashOf(doc) : null,
    status: doc.status,
    queueJobId: doc.status === 'done' ? null : `seed-job-${doc.id.slice(-4)}`,
    enqueuedAt: doc.status === 'done' ? null : daysAgo(doc.ageDays),
    processingStartedAt: doc.status === 'processing' ? daysAgo(doc.ageDays) : null,
    lastError: doc.lastError ?? null,
    createdAt: daysAgo(doc.ageDays),
    updatedAt: daysAgo(Math.max(0, doc.ageDays - 1)),
  }))
}

function hashOf(doc: SeedDocument): string {
  // Cheap deterministic stand-in for the ingest pipeline's content hash. It
  // only has to be stable and 64 hex chars wide; nothing reads it back.
  let h = 0
  const text = doc.sections.map(s => s.content).join('\n')
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0').repeat(8)
}
