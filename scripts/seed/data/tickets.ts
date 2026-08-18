// 26 support tickets for the demo tenant, in the shape the ticket-extraction
// processor would leave them: a raw transcript plus the structured fields the
// LLM pulled out of it, each with a per-field confidence score.
//
// Statuses are spread on purpose so every filter on the tickets list returns
// something: done / pending / failed, all three severities, both usefulness
// values, and eight reviewed-as-useful tickets which are the ones the list's
// `indexed` filter matches (status done + reviewedBy set + usefulness useful).
import { createHash } from 'crypto'
import { DEMO_TEAMMATE_ID, DEMO_USER_ID, DEMO_WORKSPACE_ID, daysAgo } from '../config'
import { EXTRA_TICKET_SPECS } from './tickets-extra'

export interface SeedTicket {
  id: string
  transcript: string
  title: string | null
  issueSummary: string | null
  reproSteps: string | null
  severity: 'low' | 'medium' | 'high' | null
  productArea: string
  hypothesizedRootCause: string | null
  nextAction: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  usefulness: 'useful' | 'not_useful' | null
  reviewed: boolean
  ageDays: number
  lastError?: string
  confidence: Record<string, number>
}

function ticketId(n: number): string {
  return `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

export interface TicketSpec {
  transcript: string
  title: string
  issueSummary: string
  reproSteps: string
  severity: 'low' | 'medium' | 'high'
  productArea: string
  rootCause: string
  nextAction: string
  ageDays: number
  /** done + reviewed + useful ⇒ this ticket is "indexed" and gets a chunk. */
  indexed?: boolean
  usefulness?: 'useful' | 'not_useful'
  status?: 'pending' | 'processing' | 'done' | 'failed'
  lastError?: string
  confidence?: Record<string, number>
}

const SPECS: TicketSpec[] = [
  {
    transcript:
      'Customer: Our weekly CSV export has been empty since Monday even though everyone logged time.\nAgent: Which range are you exporting?\nCustomer: Last week, Mon-Sun, filtered to the Acme project.\nAgent: I see the Acme project was switched to Restricted on Monday and you are not assigned to it, so the export returns nothing.',
    title: 'CSV export returns no rows after project set to Restricted',
    issueSummary:
      'Weekly CSV export returns zero rows for a project that was switched from Open to Restricted, because the exporting manager is not an assigned member.',
    reproSteps:
      '1. Set a project to Restricted. 2. Sign in as a manager who is not assigned to it. 3. Export Timesheets filtered to that project for last week. 4. Observe an empty CSV with headers only.',
    severity: 'high',
    productArea: 'exports',
    rootCause:
      'Restricted project visibility is applied to the export query, but the UI still offers the project in the export filter, so the result looks like data loss rather than a permission boundary.',
    nextAction:
      'Assign the manager to the project, and file a product bug to either hide restricted projects from the export filter or return an explicit permission warning instead of an empty file.',
    ageDays: 4,
    indexed: true,
    confidence: { title: 0.94, issueSummary: 0.91, reproSteps: 0.88, severity: 0.72, productArea: 0.96 },
  },
  {
    transcript:
      'Customer: Hours from my Manila team show up on the wrong day in reports.\nAgent: What time do they usually log?\nCustomer: Late evening, around 11pm.\nAgent: Your workspace time zone is New York, so an 11pm Manila entry falls on the previous day in reports.',
    title: 'Entries appear on the wrong day for members in another time zone',
    issueSummary:
      'Late-evening entries from members in UTC+8 are reported on the previous day because reports render in the workspace time zone rather than the member local time zone.',
    reproSteps:
      '1. Set workspace time zone to America/New_York. 2. Log an entry at 23:00 Asia/Manila. 3. Open a daily report. 4. The entry appears on the preceding date.',
    severity: 'medium',
    productArea: 'reporting',
    rootCause:
      'Reports intentionally normalize to the workspace time zone, which is correct for billing but surprising for distributed teams with no per-member display option.',
    nextAction:
      'Explain the workspace time zone rule and log a feature request for a per-member display time zone toggle in reports.',
    ageDays: 6,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.93, reproSteps: 0.85, severity: 0.8, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: QuickBooks stopped receiving our invoices about two days ago.\nAgent: The integration shows degraded with "AuthenticationFailed: refresh token expired".\nCustomer: We rotated our QuickBooks admin last week.\nAgent: That invalidated the connection. The owner needs to reconnect.',
    title: 'QuickBooks sync degraded after admin change invalidated refresh token',
    issueSummary:
      'Issued invoices stopped syncing to QuickBooks because the OAuth refresh token was invalidated when the customer rotated their QuickBooks admin user.',
    reproSteps:
      '1. Connect QuickBooks. 2. Remove or change the QuickBooks admin who authorized the connection. 3. Issue an invoice. 4. Sync fails with AuthenticationFailed and the integration is marked degraded after 24h of retries.',
    severity: 'high',
    productArea: 'integrations',
    rootCause:
      'The OAuth grant is bound to the authorizing QuickBooks user; removing that user revokes the refresh token, and we cannot re-authorize on their behalf.',
    nextAction:
      'Have the workspace owner reconnect from Settings → Integrations, then replay the failed invoices with the admin replay tool.',
    ageDays: 8,
    indexed: true,
    confidence: { title: 0.95, issueSummary: 0.94, reproSteps: 0.83, severity: 0.9, productArea: 0.97 },
  },
  {
    transcript:
      'Customer: Two of our contractors have duplicate entries for all of Tuesday.\nAgent: Were they offline that day?\nCustomer: Yes, our office internet was down most of the morning.\nAgent: The desktop app flushed its offline queue twice after the outage.',
    title: 'Desktop app created duplicate entries after an offline outage',
    issueSummary:
      'Duplicate time entries were created when the desktop app flushed its offline queue twice following a multi-hour network outage.',
    reproSteps:
      '1. Log entries in the desktop app while offline. 2. Restore connectivity while the app is mid-retry. 3. Observe each queued entry written twice with different ids.',
    severity: 'high',
    productArea: 'desktop-app',
    rootCause:
      'The offline queue flush is not idempotent: entries are keyed by a client-generated id that is regenerated on retry, so the server cannot deduplicate them.',
    nextAction:
      'Bulk-delete the duplicates with the admin tool and escalate to the desktop team to make the flush idempotent on a stable client id.',
    ageDays: 10,
    indexed: true,
    confidence: { title: 0.92, issueSummary: 0.9, reproSteps: 0.87, severity: 0.93, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: I approved a week by mistake and now I cannot edit it.\nAgent: Approved weeks lock their entries. An Owner can reopen the week.\nCustomer: We already invoiced from it.\nAgent: Reopening will not change the invoice; that has to be credited separately.',
    title: 'Approved week locked after accidental approval, already invoiced',
    issueSummary:
      'A manager approved the wrong week, entries locked, and the hours were already drawn into an issued invoice, so reopening alone does not fix the customer billing.',
    reproSteps:
      '1. Approve a week. 2. Generate and issue an invoice from it. 3. Reopen the week as Owner. 4. Observe the invoice is unchanged and still holds the original line items.',
    severity: 'medium',
    productArea: 'approvals',
    rootCause:
      'Invoices are deliberately frozen on issue so historical billing stays reproducible; reopening a week is intentionally decoupled from invoice state.',
    nextAction:
      'Walk the customer through reopening the week and issuing a credit note, and note the decoupling in the approvals doc.',
    ageDays: 12,
    indexed: true,
    confidence: { title: 0.88, issueSummary: 0.91, reproSteps: 0.79, severity: 0.7, productArea: 0.94 },
  },
  {
    transcript:
      'Customer: Utilization for our team reads 140% which cannot be right.\nAgent: Three of your members have capacity set to zero.\nCustomer: Those are our part-time designers.\nAgent: Members with zero capacity are excluded from the average, which inflates the rest.',
    title: 'Utilization inflated by members with zero capacity',
    issueSummary:
      'Team utilization reads above 100% because members with a capacity of zero are excluded from the denominator rather than counted with their real part-time capacity.',
    reproSteps:
      '1. Set capacity to 0 for several members. 2. Log billable hours for them. 3. Open the utilization report. 4. Team utilization exceeds 100%.',
    severity: 'medium',
    productArea: 'reporting',
    rootCause:
      'Zero-capacity exclusion protects against divide-by-zero but silently changes the meaning of the team average when zero is used as a stand-in for part-time.',
    nextAction:
      'Set real part-time capacities on those member profiles and request a warning banner when any included member has zero capacity.',
    ageDays: 14,
    indexed: true,
    confidence: { title: 0.86, issueSummary: 0.89, reproSteps: 0.84, severity: 0.66, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: Our webhook endpoint got disabled and we did not notice for a week.\nAgent: It failed six deliveries over 12 hours and was auto-disabled. The owner was emailed.\nCustomer: That email went to someone who left.',
    title: 'Webhook auto-disabled, notification sent to a departed owner',
    issueSummary:
      'A webhook endpoint was auto-disabled after repeated delivery failures, but the only notification went to the workspace owner address, which belonged to a departed employee.',
    reproSteps:
      '1. Point a webhook at an endpoint returning 500. 2. Let six deliveries fail over ~12 hours. 3. Endpoint is disabled and only the owner is emailed.',
    severity: 'medium',
    productArea: 'api-webhooks',
    rootCause:
      'Integration health notifications are owner-only with no secondary contact and no in-app surfacing on the integrations screen.',
    nextAction:
      'Re-enable the endpoint, transfer workspace ownership, and file a request for in-app webhook health status plus multiple notification recipients.',
    ageDays: 16,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.92, reproSteps: 0.8, severity: 0.74, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: After we enforced SSO nobody can log in, including me.\nAgent: Your IdP metadata URL returns 404 — the certificate rotation last night changed the endpoint.\nCustomer: How do we get back in?\nAgent: The Owner can still use password login; that path stays open by design.',
    title: 'SSO enforcement locked out members after IdP metadata URL changed',
    issueSummary:
      'All members were locked out after SSO enforcement because the identity provider metadata URL changed during a certificate rotation; only the Owner break-glass password login still worked.',
    reproSteps:
      '1. Configure and enforce SAML SSO. 2. Rotate the IdP certificate so the metadata URL changes. 3. Attempt member sign-in. 4. Authentication fails for everyone except the Owner.',
    severity: 'high',
    productArea: 'auth-sso',
    rootCause:
      'Metadata is fetched at sign-in with no cached fallback and no health check, so an IdP-side URL change becomes an immediate full lockout.',
    nextAction:
      'Update the metadata URL via the Owner break-glass login and request periodic metadata health checks with an alert before expiry.',
    ageDays: 18,
    indexed: true,
    confidence: { title: 0.93, issueSummary: 0.95, reproSteps: 0.86, severity: 0.96, productArea: 0.94 },
  },
  {
    transcript:
      'Customer: The mobile app will not let me edit last week entries.\nAgent: Editing entries older than two days is desktop-only.\nCustomer: That is not documented anywhere I could find.',
    title: 'Mobile app cannot edit entries older than two days',
    issueSummary:
      'A member could not edit older entries on mobile; the two-day mobile edit window is intentional but was not discoverable in the app.',
    reproSteps:
      '1. Open an entry from four days ago in the mobile app. 2. Tap edit. 3. The edit control is disabled with no explanation.',
    severity: 'low',
    productArea: 'mobile',
    rootCause: 'Intentional product constraint with no inline explanation in the UI.',
    nextAction: 'Point the customer at the mobile guide and request inline copy explaining the limit.',
    ageDays: 20,
    usefulness: 'not_useful',
    confidence: { title: 0.82, issueSummary: 0.8, reproSteps: 0.77, severity: 0.6, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Rounding changed our invoice totals after we switched to nearest 15.\nAgent: Rounding is applied per entry, not per day.\nCustomer: So six short entries each round up separately?\nAgent: Correct.',
    title: 'Per-entry rounding inflated totals after switching to nearest 15 minutes',
    issueSummary:
      'Switching the workspace rounding rule to nearest 15 minutes inflated un-invoiced totals because rounding applies per entry rather than per day.',
    reproSteps:
      '1. Set rounding to nearest 15. 2. Log six 7-minute entries on one day. 3. Open a report. 4. The day totals 1h30m instead of 45m.',
    severity: 'medium',
    productArea: 'billing',
    rootCause:
      'Per-entry rounding is the documented behaviour but is counter-intuitive for teams that log many short entries.',
    nextAction: 'Recommend a per-day rounding option and point to the rounding rules doc.',
    ageDays: 22,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.85, reproSteps: 0.82, severity: 0.68, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Export of 6 months of data never arrives by email.\nAgent: It exceeded the 50,000 row cap and failed silently.\nCustomer: We got no error at all.',
    title: 'Large export exceeds row cap and fails without notifying the requester',
    issueSummary:
      'A six-month export exceeded the 50,000-row cap and failed without any email or in-app error, so the requester waited indefinitely.',
    reproSteps:
      '1. Request a CSV export spanning six months on a large workspace. 2. Wait. 3. No email arrives and no error appears in the UI.',
    severity: 'high',
    productArea: 'exports',
    rootCause:
      'The row-cap check runs inside the worker after the request is acknowledged, and the failure path does not send a notification.',
    nextAction: 'Split the export by quarter and file a bug for a failure email on capped exports.',
    ageDays: 24,
    usefulness: 'useful',
    confidence: { title: 0.91, issueSummary: 0.9, reproSteps: 0.81, severity: 0.88, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: We removed a member and their hours vanished from last quarter.\nAgent: Hours are reassigned to "Removed member", not deleted. Group by project rather than member to see them.',
    title: 'Removed member hours appear missing when grouping a report by member',
    issueSummary:
      'After removing a member, their historical hours were reassigned to a placeholder identity, which reads as data loss when a report is grouped by member.',
    reproSteps:
      '1. Remove a member with historical entries. 2. Run a report for a past quarter grouped by member. 3. Their name is absent and hours sit under "Removed member".',
    severity: 'low',
    productArea: 'reporting',
    rootCause: 'Placeholder reassignment preserves totals but loses the original name in member-grouped views.',
    nextAction: 'Explain the placeholder behaviour and suggest grouping by project for historical reports.',
    ageDays: 26,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.86, reproSteps: 0.78, severity: 0.62, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Scheduled export stopped arriving.\nAgent: It failed three times in a row and was auto-paused. The recipient mailbox was rejecting our sender.',
    title: 'Scheduled export auto-paused after recipient mailbox rejected delivery',
    issueSummary:
      'A weekly scheduled export was auto-paused after three consecutive delivery failures caused by the recipient mail server rejecting the sender.',
    reproSteps:
      '1. Configure a scheduled export to an address that hard-bounces. 2. Wait three cycles. 3. The schedule is paused and the owner notified.',
    severity: 'medium',
    productArea: 'exports',
    rootCause: 'Delivery bounces count as export failures, so a mail-side problem pauses a working export job.',
    nextAction:
      'Allow-list our sending domain, resume the schedule, and request bounce reasons in the pause notification.',
    ageDays: 28,
    usefulness: 'useful',
    confidence: { title: 0.89, issueSummary: 0.88, reproSteps: 0.8, severity: 0.71, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: Our API client keeps getting 429s.\nAgent: You are at 210 requests per minute against a 120 limit. Honour the Retry-After header.',
    title: 'API client exceeding 120 req/min rate limit and ignoring Retry-After',
    issueSummary:
      'A customer integration is being throttled because it issues roughly 210 requests per minute against the 120 per-key limit and retries immediately instead of honouring Retry-After.',
    reproSteps:
      '1. Issue more than 120 API requests in a minute with one key. 2. Observe 429 responses with a Retry-After header. 3. Retrying immediately extends the throttle.',
    severity: 'medium',
    productArea: 'api-webhooks',
    rootCause: 'Client-side retry loop ignores Retry-After and has no backoff.',
    nextAction: 'Share the rate-limit docs and recommend exponential backoff plus batching of entry reads.',
    ageDays: 30,
    usefulness: 'useful',
    confidence: { title: 0.92, issueSummary: 0.91, reproSteps: 0.85, severity: 0.7, productArea: 0.96 },
  },
  {
    transcript:
      'Customer: A timer ran all weekend and logged 63 hours.\nAgent: The 12-hour confirmation prompt only appears when you stop the timer in the web app; the mobile app saved it without prompting.',
    title: 'Long-running timer saved from mobile without the 12-hour confirmation prompt',
    issueSummary:
      'A timer left running over a weekend saved 63 hours because the mobile app does not show the 12-hour confirmation prompt that the web app shows.',
    reproSteps:
      '1. Start a timer in the web app. 2. Leave it running more than 12 hours. 3. Stop it from the mobile app. 4. The entry saves with no confirmation.',
    severity: 'medium',
    productArea: 'timers',
    rootCause: 'The long-timer guard is implemented in the web client only, not enforced server-side.',
    nextAction: 'Correct the entry manually and file a bug to move the guard server-side so all clients inherit it.',
    ageDays: 32,
    usefulness: 'useful',
    confidence: { title: 0.9, issueSummary: 0.93, reproSteps: 0.88, severity: 0.75, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Invoice shows hours we already billed last month.\nAgent: Those entries were released when you voided invoice INV-2231, so they returned to the un-invoiced pool.',
    title: 'Voided invoice released entries back into a later invoice',
    issueSummary:
      'Hours reappeared on a new invoice because voiding an earlier invoice released its entries back into the un-invoiced pool, which is the documented behaviour.',
    reproSteps:
      '1. Issue an invoice. 2. Void it. 3. Generate a new invoice for the same client and period. 4. The released entries are included again.',
    severity: 'low',
    productArea: 'billing',
    rootCause:
      'Void is designed to release entries; the customer expected void to also exclude those hours permanently.',
    nextAction: 'Explain void semantics and suggest marking the entries non-billable if they should never be billed.',
    ageDays: 34,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.87, reproSteps: 0.83, severity: 0.6, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: New hires from Okta all landed with the wrong role.\nAgent: Just-in-time provisioning always creates members with the Member role; it never grants Manager.',
    title: 'SSO just-in-time provisioning always assigns the Member role',
    issueSummary:
      'Members provisioned through SAML JIT always receive the Member role regardless of IdP group membership, requiring manual promotion.',
    reproSteps:
      '1. Enable SAML with JIT provisioning. 2. Sign in as a new user in an IdP group intended to be managers. 3. The Helio Labs role is Member.',
    severity: 'low',
    productArea: 'auth-sso',
    rootCause: 'Role mapping from IdP group claims is not implemented; JIT deliberately grants the least privilege.',
    nextAction: 'Promote the affected users manually and log a feature request for group-to-role mapping.',
    ageDays: 36,
    usefulness: 'not_useful',
    confidence: { title: 0.83, issueSummary: 0.84, reproSteps: 0.76, severity: 0.58, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: Report link I shared shows fewer rows for my colleague.\nAgent: Shared reports respect the viewer permissions, so a Member sees only rows they are allowed to see.',
    title: 'Shared report shows different row counts per viewer',
    issueSummary:
      'A shared report link renders different totals for different viewers because permissions are applied at view time rather than baked into the link.',
    reproSteps:
      '1. Save a workspace-wide report as a Manager. 2. Share the link with a Member. 3. Compare totals; the Member sees a subset.',
    severity: 'low',
    productArea: 'reporting',
    rootCause:
      'Viewer-scoped permissions on shared links are intentional but surprising when totals are compared verbally.',
    nextAction: 'Explain the behaviour and suggest exporting a PDF when a fixed snapshot is needed.',
    ageDays: 38,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.88, reproSteps: 0.79, severity: 0.6, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Import failed with "row 214: unknown task" and nothing was imported.\nAgent: Imports are all-or-nothing by design. Fix row 214 and re-upload.',
    title: 'Spreadsheet import rejects the whole file on a single unknown task',
    issueSummary:
      'A CSV import of 900 rows failed entirely because one row referenced a task that does not exist; imports are transactional by design.',
    reproSteps:
      '1. Prepare a CSV with one row referencing a non-existent task. 2. Upload it. 3. The import fails with a line number and writes nothing.',
    severity: 'medium',
    productArea: 'imports',
    rootCause: 'All-or-nothing import semantics prevent partial state but make large files painful to fix iteratively.',
    nextAction: 'Fix the offending row and request a validation-only dry-run mode that reports every bad row at once.',
    ageDays: 40,
    usefulness: 'useful',
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.86, severity: 0.69, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: We downgraded from Business and SSO stopped working mid-day.\nAgent: Downgrades disable SAML at the switchover. With enforcement still on, members were locked out.',
    title: 'Plan downgrade disabled SAML while SSO enforcement was still on',
    issueSummary:
      'Downgrading from the Business plan disabled SAML while SSO enforcement remained enabled, locking out every member except the Owner.',
    reproSteps:
      '1. Enable and enforce SAML on Business. 2. Downgrade the plan. 3. At the period switchover, member sign-in fails.',
    severity: 'high',
    productArea: 'billing',
    rootCause: 'Plan downgrade does not validate dependent feature state before disabling SAML.',
    nextAction:
      'Turn off SSO enforcement via the Owner login, then file a bug to block the downgrade while enforcement is active.',
    ageDays: 42,
    usefulness: 'useful',
    confidence: { title: 0.94, issueSummary: 0.93, reproSteps: 0.87, severity: 0.95, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Tag rename did not update older entries.\nAgent: Renames should update every entry. Let me check.\nAgent: Confirmed — entries in archived projects were skipped.',
    title: 'Tag rename skips entries that belong to archived projects',
    issueSummary:
      'Renaming a workspace tag updated active entries but silently skipped entries attached to archived projects, leaving two tag names in reports.',
    reproSteps:
      '1. Tag entries across an active and an archived project. 2. Rename the tag. 3. Report by tag; the archived entries still carry the old name.',
    severity: 'medium',
    productArea: 'tags',
    rootCause: 'The rename query filters out archived projects, which is correct for pickers but wrong for a data rename.',
    nextAction: 'Escalate as a data-consistency bug; the rename must not be scoped by archive state.',
    ageDays: 44,
    usefulness: 'useful',
    confidence: { title: 0.89, issueSummary: 0.9, reproSteps: 0.85, severity: 0.72, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: Weekly reminders go to people on leave.\nAgent: Reminders skip approved leave. Their leave was recorded as a non-billable project instead of leave.',
    title: 'Weekly reminders sent to members whose leave was logged as a project',
    issueSummary:
      'Reminder emails reached members on holiday because their absence was logged as time on a non-billable project rather than as approved leave.',
    reproSteps:
      '1. Log a full week to a non-billable "Holiday" project. 2. Wait for the weekly reminder cycle. 3. The member is still reminded.',
    severity: 'low',
    productArea: 'notifications',
    rootCause: 'The reminder suppression check reads the leave record, which was never created.',
    nextAction: 'Show the customer how to record approved leave and note the distinction in the reminders doc.',
    ageDays: 46,
    usefulness: 'not_useful',
    confidence: { title: 0.81, issueSummary: 0.83, reproSteps: 0.75, severity: 0.57, productArea: 0.86 },
  },
  {
    transcript:
      'Customer: Can you restore the workspace we deleted 40 days ago?\nAgent: It was purged after 30 days. There is no restore path once purged.',
    title: 'Restore requested for a workspace already purged after the 30-day window',
    issueSummary:
      'A customer asked to restore a workspace deleted 40 days earlier; it was purged at day 30 and cannot be recovered from disaster-recovery backups.',
    reproSteps: '1. Delete a workspace. 2. Wait more than 30 days. 3. Request restore. 4. No restore path exists.',
    severity: 'high',
    productArea: 'data-retention',
    rootCause:
      'Purge is irreversible by design, and point-in-time backups are cluster-wide so they cannot resurrect a single tenant.',
    nextAction:
      'Confirm plainly that recovery is impossible and recommend mandatory pre-deletion exports plus a longer soft-delete window for their plan.',
    ageDays: 48,
    usefulness: 'useful',
    confidence: { title: 0.93, issueSummary: 0.94, reproSteps: 0.8, severity: 0.92, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: I get "you cannot approve your own timesheet" but I am a Manager.\nAgent: Managers cannot approve their own week; another Manager or the Owner must.',
    title: 'Manager blocked from approving their own timesheet',
    issueSummary: 'A Manager could not approve their own submitted week; self-approval is blocked regardless of role.',
    reproSteps: '1. Sign in as a Manager. 2. Submit your own week. 3. Open Approvals. 4. The approve action is rejected.',
    severity: 'low',
    productArea: 'approvals',
    rootCause: 'Intentional separation-of-duties rule with an error message that does not explain the reason.',
    nextAction: 'Explain the rule and request clearer copy on the error.',
    ageDays: 50,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.85, reproSteps: 0.82, severity: 0.6, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: Timer jumped forward two hours after your Tuesday deploy.\nAgent: We had clock skew on one node during the rollout; timers self-corrected on the next heartbeat.',
    title: 'Running timers jumped after deploy due to node clock skew',
    issueSummary:
      'Running timers displayed a sudden jump during a deploy because pods rescheduled onto a node with unsynchronized clocks; durations self-corrected afterwards.',
    reproSteps:
      '1. Start a timer. 2. Trigger a rollout onto a node with clock skew. 3. Observe the displayed elapsed time jump. 4. Wait one heartbeat; it corrects.',
    severity: 'medium',
    productArea: 'timers',
    rootCause: 'Node time synchronization drift, not an application bug — durations derive from a stored start timestamp.',
    nextAction: 'Confirm no stored entries were affected and reference the timer-drift runbook.',
    ageDays: 52,
    usefulness: 'useful',
    confidence: { title: 0.9, issueSummary: 0.91, reproSteps: 0.84, severity: 0.73, productArea: 0.89 },
  },
  // Two tickets deliberately left mid-pipeline so the status filter has rows.
  {
    transcript:
      'Customer: Our Friday export arrived with the Notes column blank for every row. Nothing changed on our side.',
    title: '',
    issueSummary: '',
    reproSteps: '',
    severity: 'medium',
    productArea: 'general',
    rootCause: '',
    nextAction: '',
    ageDays: 0,
    status: 'pending',
  },
  {
    transcript: 'Customer: hi\nAgent: Hello, how can I help?\nCustomer: nvm figured it out',
    title: '',
    issueSummary: '',
    reproSteps: '',
    severity: 'low',
    productArea: 'general',
    rootCause: '',
    nextAction: '',
    ageDays: 1,
    status: 'failed',
    lastError:
      'Extraction failed: transcript too thin to determine an issue (no reproduction detail, no product area signal)',
  },
]

// EXTRA_TICKET_SPECS lives in its own module purely for readability.
const ALL_TICKET_SPECS: TicketSpec[] = [...SPECS, ...EXTRA_TICKET_SPECS]

export const seedTickets: SeedTicket[] = ALL_TICKET_SPECS.map((spec, index) => {
  const done = (spec.status ?? 'done') === 'done'
  return {
    id: ticketId(index + 1),
    transcript: spec.transcript,
    title: done ? spec.title : null,
    issueSummary: done ? spec.issueSummary : null,
    reproSteps: done ? spec.reproSteps : null,
    severity: done ? spec.severity : null,
    productArea: done ? spec.productArea : 'general',
    hypothesizedRootCause: done ? spec.rootCause : null,
    nextAction: done ? spec.nextAction : null,
    status: spec.status ?? 'done',
    usefulness: spec.indexed ? 'useful' : (spec.usefulness ?? null),
    reviewed: Boolean(spec.indexed) || spec.usefulness !== undefined,
    ageDays: spec.ageDays,
    lastError: spec.lastError,
    confidence: spec.confidence ?? {},
  }
})

export function transcriptHash(transcript: string): string {
  return createHash('sha256').update(transcript).digest('hex')
}

/** Tickets that satisfy the list view's `indexed` filter and get a chunk. */
export function indexedTickets(): SeedTicket[] {
  return seedTickets.filter(t => t.status === 'done' && t.reviewed && t.usefulness === 'useful')
}

/** Text the ticket chunk carries, mirroring syncTicketChunk in @repo/ai. */
export function ticketChunkContent(ticket: SeedTicket): string {
  return [ticket.title, ticket.issueSummary, ticket.reproSteps, ticket.hypothesizedRootCause, ticket.nextAction]
    .filter(Boolean)
    .join('\n\n')
}

export function buildTicketRows() {
  return seedTickets.map(ticket => ({
    id: ticket.id,
    workspaceId: DEMO_WORKSPACE_ID,
    transcript: ticket.transcript,
    transcriptHash: transcriptHash(ticket.transcript),
    title: ticket.title || null,
    issueSummary: ticket.issueSummary || null,
    reproSteps: ticket.reproSteps || null,
    severity: ticket.severity,
    productArea: ticket.productArea,
    hypothesizedRootCause: ticket.hypothesizedRootCause || null,
    nextAction: ticket.nextAction || null,
    status: ticket.status,
    queueJobId: ticket.status === 'done' ? null : `seed-ticket-${ticket.id.slice(-4)}`,
    enqueuedAt: daysAgo(ticket.ageDays),
    processingStartedAt: ticket.status === 'pending' ? null : daysAgo(ticket.ageDays),
    lastError: ticket.lastError ?? null,
    fieldConfidence: ticket.confidence,
    usefulness: ticket.usefulness,
    editState: ticket.reviewed ? (ticket.usefulness === 'useful' ? 'accepted' : 'heavily_edited') : null,
    feedbackNote:
      ticket.usefulness === 'not_useful' ? 'Extraction was thin — rewrote the summary before filing.' : null,
    // Reviewers alternate so the tickets list shows more than one name.
    reviewedBy: ticket.reviewed ? (ticket.ageDays % 2 === 0 ? DEMO_USER_ID : DEMO_TEAMMATE_ID) : null,
    reviewedAt: ticket.reviewed ? daysAgo(Math.max(0, ticket.ageDays - 1)) : null,
    category: ticket.productArea,
    resolvedAt: ticket.status === 'done' && ticket.reviewed ? daysAgo(Math.max(0, ticket.ageDays - 1)) : null,
    assigneeId: ticket.ageDays % 3 === 0 ? DEMO_TEAMMATE_ID : DEMO_USER_ID,
    createdAt: daysAgo(ticket.ageDays),
    updatedAt: daysAgo(Math.max(0, ticket.ageDays - 1)),
  }))
}
