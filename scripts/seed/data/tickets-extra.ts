// 54 further support tickets, concatenated onto tickets.ts's own list.
//
// Same shape and same rules as the first batch: a real transcript, the fields a
// successful extraction would have produced, and a confidence map. Tickets
// flagged `indexed` become part of the retrieval corpus (one chunk each), so
// their summaries have to be worth retrieving.
import type { TicketSpec } from './tickets'

export const EXTRA_TICKET_SPECS: TicketSpec[] = [
  {
    transcript:
      'Customer: Budget alerts never fired even though we blew past the retainer.\nAgent: Budgets measure approved time only. Half that month was still awaiting approval.',
    title: 'Budget alerts silent because the hours were never approved',
    issueSummary:
      'A project passed 100% of its budget without firing an alert because budget progress counts approved time only and most of the month was still pending approval.',
    reproSteps:
      '1. Set a project budget. 2. Log hours past the budget but leave the week unapproved. 3. No alert fires until the week is approved.',
    severity: 'medium',
    productArea: 'budgets',
    rootCause:
      'Budgets deliberately ignore unapproved time so alerts are not tripped by draft entries, but the UI does not show pending hours against the budget bar.',
    nextAction: 'Approve the backlog and request a "pending" segment on the budget bar so the gap is visible.',
    ageDays: 3,
    indexed: true,
    confidence: { title: 0.91, issueSummary: 0.9, reproSteps: 0.86, severity: 0.7, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: A member logged 60 hours in a week and nobody noticed.\nAgent: Their capacity is set to zero, so the under/over-logging warnings never evaluate.',
    title: 'Over-logging warnings never fire for members with zero capacity',
    issueSummary:
      'Members with capacity set to zero receive no over- or under-logging warnings, because both thresholds are derived from capacity.',
    reproSteps: '1. Set a member capacity to 0. 2. Log 60 hours in a week. 3. No warning appears on the timesheet.',
    severity: 'medium',
    productArea: 'capacity',
    rootCause: 'Zero capacity is used as a stand-in for part-time, and every capacity-derived check silently no-ops.',
    nextAction: 'Set a real part-time capacity and request that zero capacity be rejected at save time.',
    ageDays: 5,
    indexed: true,
    confidence: { title: 0.89, issueSummary: 0.88, reproSteps: 0.84, severity: 0.68, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: We enabled required custom fields and now the mobile app cannot save anything.\nAgent: Required fields apply everywhere, including mobile and the API, and mobile has no editor for select fields.',
    title: 'Required custom fields block saving on mobile and via the API',
    issueSummary:
      'Marking a custom field required blocks entry creation on every surface, including the mobile app and the API, where there is no editor for the field.',
    reproSteps:
      '1. Add a required single-select custom field to time entries. 2. Try to save an entry from the mobile app. 3. The save is rejected with a validation error.',
    severity: 'high',
    productArea: 'custom-fields',
    rootCause: 'Required-field validation is enforced server-side while the field editor only exists in the web client.',
    nextAction: 'Make the field optional until mobile support ships, and file the gap against the mobile roadmap.',
    ageDays: 7,
    indexed: true,
    confidence: { title: 0.93, issueSummary: 0.92, reproSteps: 0.88, severity: 0.9, productArea: 0.94 },
  },
  {
    transcript:
      'Customer: Client portal is showing hours we have not approved yet.\nAgent: It should only show approved time. Let me check.\nAgent: Those weeks were approved and then reopened; the portal cache had not refreshed.',
    title: 'Client portal briefly shows hours from a reopened week',
    issueSummary:
      'The client portal continued to display hours from a week that had been approved and then reopened, because the portal view is cached for fifteen minutes.',
    reproSteps: '1. Approve a week. 2. View the client portal. 3. Reopen the week. 4. The portal still lists the hours.',
    severity: 'high',
    productArea: 'client-portal',
    rootCause: 'The portal cache is not invalidated when an approval is cleared, only when one is granted.',
    nextAction: 'Escalate as a data-exposure-adjacent bug: reopening must invalidate the portal cache immediately.',
    ageDays: 9,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.93, reproSteps: 0.85, severity: 0.94, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Rate card update did not change our live projects.\nAgent: Applying a rate card copies the values, so existing projects keep the rates they were sold at.',
    title: 'Rate card edits do not propagate to projects already using it',
    issueSummary:
      'Editing a rate card leaves existing projects untouched, because applying a card copies its values onto the project rather than referencing it.',
    reproSteps: '1. Apply a rate card to a project. 2. Change a rate on the card. 3. The project still shows the old rate.',
    severity: 'low',
    productArea: 'billing',
    rootCause: 'Copy-on-apply keeps historical engagements reproducible but reads as a failed update.',
    nextAction: 'Explain the copy semantics and show how to re-apply the card to selected projects.',
    ageDays: 11,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.86, reproSteps: 0.83, severity: 0.62, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Two members are in different countries and both weekends are wrong.\nAgent: Working days are per workspace by default. You can override them per member.',
    title: 'Workspace working days wrong for members in another region',
    issueSummary:
      'A distributed team saw incorrect weekend handling because working days were left at the workspace default rather than overridden per member.',
    reproSteps:
      '1. Set workspace working days to Mon-Fri. 2. Add a member whose weekend is Fri-Sat. 3. Their capacity is calculated against the wrong days.',
    severity: 'medium',
    productArea: 'capacity',
    rootCause: 'Per-member working-day overrides exist but are not surfaced during member onboarding.',
    nextAction: 'Set the override and request that the invite flow ask for working days.',
    ageDays: 13,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.87, reproSteps: 0.8, severity: 0.66, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Expenses are not appearing on the client invoice.\nAgent: Only expenses flagged billable flow onto an invoice. Yours are marked reimbursable but not billable.',
    title: 'Reimbursable expenses omitted from client invoices',
    issueSummary:
      'Expenses marked reimbursable but not billable were excluded from the client invoice; the two flags are independent.',
    reproSteps: '1. Record an expense as reimbursable only. 2. Generate a client invoice. 3. The expense is absent.',
    severity: 'medium',
    productArea: 'expenses',
    rootCause:
      'Reimbursable governs paying the employee back; billable governs charging the client. Nothing in the UI explains the split.',
    nextAction: 'Flag the expenses billable and request clearer labels on the expense form.',
    ageDays: 15,
    usefulness: 'useful',
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.84, severity: 0.7, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Someone deleted a whole week of a contractor time and we cannot get it back.\nAgent: Deleted entries are removed immediately and are not recoverable.',
    title: 'Deleted time entries are unrecoverable',
    issueSummary:
      'A week of entries was deleted by a manager and cannot be restored; entry deletion is immediate and permanent by design.',
    reproSteps: '1. Delete entries in an unsubmitted week. 2. Attempt recovery. 3. No restore path exists.',
    severity: 'high',
    productArea: 'data-retention',
    rootCause: 'Entries are hard-deleted; only workspaces have a soft-delete window.',
    nextAction:
      'Rebuild the week from the contractor own records, and recommend timesheet locking so historical weeks cannot be edited or deleted.',
    ageDays: 17,
    indexed: true,
    confidence: { title: 0.92, issueSummary: 0.91, reproSteps: 0.79, severity: 0.93, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: 2FA enrolment locked out a member who lost their phone.\nAgent: Recovery codes are the only way back in — we cannot disable 2FA on request.',
    title: 'Member locked out after losing their 2FA device',
    issueSummary:
      'A member with 2FA enabled lost their device and had not stored recovery codes; support cannot disable 2FA, so the owner had to remove and re-invite them.',
    reproSteps: '1. Enrol in 2FA. 2. Lose the device without saving recovery codes. 3. Sign-in cannot be completed.',
    severity: 'high',
    productArea: 'auth-sso',
    rootCause: 'Support-side 2FA removal is deliberately not possible, since it would defeat the control.',
    nextAction:
      'Owner removes and re-invites the member, and the workspace is advised to require recovery-code download at enrolment.',
    ageDays: 19,
    indexed: true,
    confidence: { title: 0.94, issueSummary: 0.93, reproSteps: 0.87, severity: 0.91, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: Multi-currency report totals shift every time we open them.\nAgent: They should be stable — reports use the rate on each entry creation date.\nAgent: Your base currency was changed last week, which re-derived everything.',
    title: 'Report totals moved after the workspace base currency was changed',
    issueSummary:
      'Historical revenue figures changed because the workspace base currency was switched, which re-converts every entry at its original date rate into the new base.',
    reproSteps: '1. Log entries in a client currency. 2. Change the workspace base currency. 3. Historical totals differ.',
    severity: 'medium',
    productArea: 'billing',
    rootCause: 'Base-currency changes are applied retroactively to reporting, with no warning about historical impact.',
    nextAction: 'Explain the effect and request a confirmation dialog before a base currency change.',
    ageDays: 21,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.9, reproSteps: 0.81, severity: 0.72, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: The audit log does not show who edited an entry.\nAgent: It shows both the actor and the affected member. You were filtering by member, which hides the manager who made the change.',
    title: 'Audit log filter by member hides the acting manager',
    issueSummary:
      'Filtering the audit log by member returns entries about that member but not the manager who performed the action, which reads as missing attribution.',
    reproSteps:
      '1. Have a manager edit a member entry. 2. Filter the audit log by that member. 3. The actor column shows the member, not the manager.',
    severity: 'low',
    productArea: 'audit',
    rootCause: 'The filter matches the affected member field, and the UI does not make the actor/affected distinction obvious.',
    nextAction: 'Show how to filter by actor and request clearer column labelling.',
    ageDays: 23,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.85, reproSteps: 0.82, severity: 0.6, productArea: 0.86 },
  },
  {
    transcript:
      'Customer: Bulk edit changed the project on entries in an approved week.\nAgent: That should be blocked. Which week?\nAgent: Confirmed — bulk edit skips the approval lock check.',
    title: 'Bulk edit bypasses the approval lock on submitted weeks',
    issueSummary:
      'Multi-select bulk edit changed the project on entries belonging to an approved, locked week, which single-entry editing correctly refuses.',
    reproSteps:
      '1. Approve a week. 2. Multi-select entries in it from the timesheet. 3. Bulk change the project. 4. The change is applied despite the lock.',
    severity: 'high',
    productArea: 'approvals',
    rootCause: 'The lock check lives in the single-entry update path and was not applied to the bulk mutation.',
    nextAction: 'Escalate as a Sev-2 correctness bug; approved weeks must be immutable through every path.',
    ageDays: 25,
    indexed: true,
    confidence: { title: 0.95, issueSummary: 0.94, reproSteps: 0.91, severity: 0.93, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: Timesheet locking blocked our accountant from fixing a coding error.\nAgent: An Owner can unlock a specific week, with a reason recorded in the audit log.',
    title: 'Locked historical week blocks a legitimate correction',
    issueSummary:
      'Automatic timesheet locking prevented a correction to a historical week; an Owner can unlock a single week with an audited reason.',
    reproSteps: '1. Enable locking older than 30 days. 2. Try to edit a 45-day-old entry. 3. The edit is refused.',
    severity: 'low',
    productArea: 'approvals',
    rootCause: 'Locking is intentional; the error message does not mention the Owner unlock path.',
    nextAction: 'Walk the Owner through unlocking and request the error message name the remedy.',
    ageDays: 27,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.84, reproSteps: 0.8, severity: 0.6, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Search does not find an entry I know exists.\nAgent: Search is prefix-matched per word. Searching "voice" will not find "invoice".',
    title: 'Search misses matches because it is prefix-based, not substring',
    issueSummary: 'A customer could not find entries by searching a mid-word fragment; search matches word prefixes only.',
    reproSteps: '1. Create an entry with the note "invoice review". 2. Search "voice". 3. No results.',
    severity: 'low',
    productArea: 'search',
    rootCause: 'Prefix matching keeps the index small and fast; substring search is not supported.',
    nextAction: 'Explain the matching rule and log a request for substring search on notes.',
    ageDays: 29,
    usefulness: 'not_useful',
    confidence: { title: 0.83, issueSummary: 0.82, reproSteps: 0.79, severity: 0.58, productArea: 0.85 },
  },
  {
    transcript:
      'Customer: Our data residency is EU but support in the US answered our ticket.\nAgent: Support access is logged and permitted regardless of region; residency governs where data is stored, not who may support you.',
    title: 'Confusion between data residency and support access region',
    issueSummary:
      'A customer expected EU data residency to restrict which support staff could view their workspace; residency governs storage location only.',
    reproSteps: 'Not a reproducible defect — a documentation and expectation gap.',
    severity: 'medium',
    productArea: 'data-retention',
    rootCause: 'The residency documentation describes storage but is silent on support access.',
    nextAction: 'Send the access-logging policy and request the residency doc state the support model explicitly.',
    ageDays: 31,
    usefulness: 'useful',
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.55, severity: 0.74, productArea: 0.83 },
  },
  {
    transcript:
      'Customer: Portal contact can see a project they should not.\nAgent: Portal contacts see projects they are attached to. That contact was attached to the parent client, which includes all of its projects.',
    title: 'Portal contact attached at client level sees every project for that client',
    issueSummary:
      'A client contact saw more projects than intended because portal access was granted at the client level, which covers all projects under it.',
    reproSteps: '1. Attach a contact to a client. 2. Grant portal access. 3. The contact sees every project for that client.',
    severity: 'high',
    productArea: 'client-portal',
    rootCause: 'Portal scope follows the attachment level, and client-level attachment is the default in the UI.',
    nextAction: 'Re-attach the contact to specific projects and request that project-level be the default.',
    ageDays: 33,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.92, reproSteps: 0.86, severity: 0.88, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Keyboard shortcut S starts a timer while I am typing a note.\nAgent: Shortcuts are disabled while a text field has focus. Which field were you in?\nAgent: The tag picker is not a text field, so it does not suppress shortcuts.',
    title: 'Keyboard shortcuts fire while typing in the tag picker',
    issueSummary:
      'Single-key shortcuts trigger while the user is typing in the tag picker, because the picker is not treated as a focused text input.',
    reproSteps: '1. Open the tag picker. 2. Type a tag name containing "s". 3. A timer starts.',
    severity: 'medium',
    productArea: 'timers',
    rootCause: 'The shortcut suppression check tests for input and textarea elements and misses the combobox.',
    nextAction: 'File a frontend bug to suppress shortcuts for any focused editable control.',
    ageDays: 35,
    usefulness: 'useful',
    confidence: { title: 0.89, issueSummary: 0.88, reproSteps: 0.9, severity: 0.66, productArea: 0.84 },
  },
  {
    transcript:
      'Customer: Archived project still appears in our report.\nAgent: Archiving hides a project from pickers but keeps its history reportable for periods when it was active.',
    title: 'Archived projects still appear in historical reports',
    issueSummary:
      'A customer expected archiving to remove a project from reporting; archiving only hides it from pickers and preserves historical reportability.',
    reproSteps: '1. Archive a project with logged time. 2. Run a report for a past period. 3. The project still appears.',
    severity: 'low',
    productArea: 'reporting',
    rootCause: 'Archiving is deliberately non-destructive so historical totals and invoices stay correct.',
    nextAction: 'Explain archive versus delete and show the report filter that excludes archived projects.',
    ageDays: 37,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.87, reproSteps: 0.83, severity: 0.6, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Session revoke did not log a user out of the desktop app.\nAgent: Web is immediate; desktop and mobile pick it up at the next sync because they cache a short-lived token.',
    title: 'Session revocation delayed on desktop and mobile clients',
    issueSummary:
      'Revoking a session logged the user out of the web app immediately but the desktop app remained usable until its next sync.',
    reproSteps: '1. Sign in on desktop. 2. Revoke the session from the web app. 3. The desktop app continues working briefly.',
    severity: 'medium',
    productArea: 'auth-sso',
    rootCause: 'Native clients hold a short-lived cached access token and only re-validate on sync.',
    nextAction:
      'Explain the sync window and, for offboarding, recommend removing the member outright rather than revoking a session.',
    ageDays: 39,
    indexed: true,
    confidence: { title: 0.91, issueSummary: 0.9, reproSteps: 0.87, severity: 0.79, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: We hit the API rate limit with only one key.\nAgent: The limit is 120 per minute per key. Two keys can be live at once, which is also how you rotate without downtime.',
    title: 'Single API key insufficient for a high-volume integration',
    issueSummary:
      'An integration exceeded the 120 requests-per-minute per-key limit; two keys can be active simultaneously, which also enables zero-downtime rotation.',
    reproSteps: '1. Drive more than 120 requests per minute on one key. 2. Receive 429 with Retry-After.',
    severity: 'low',
    productArea: 'api-webhooks',
    rootCause: 'Rate limits are per key by design; the docs do not mention using both keys to raise headroom.',
    nextAction: 'Suggest splitting traffic across both keys and batching reads.',
    ageDays: 41,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.88, reproSteps: 0.84, severity: 0.62, productArea: 0.94 },
  },
  {
    transcript:
      'Customer: Webhook retries delivered the same event six times.\nAgent: Retries repeat the same payload with the same event id. Consumers need to be idempotent on it.',
    title: 'Webhook consumer processed retried deliveries as new events',
    issueSummary:
      'A customer system created duplicate records because it treated webhook retries as distinct events instead of deduplicating on the event id.',
    reproSteps:
      '1. Make the endpoint fail. 2. Let retries run. 3. Fix the endpoint. 4. All retries deliver the same event id.',
    severity: 'medium',
    productArea: 'api-webhooks',
    rootCause: 'At-least-once delivery is the documented contract; the consumer assumed exactly-once.',
    nextAction: 'Point at the event id and recommend an idempotency key on their side.',
    ageDays: 43,
    indexed: true,
    confidence: { title: 0.92, issueSummary: 0.91, reproSteps: 0.88, severity: 0.73, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: The PDF export has no notes column.\nAgent: PDF is the client-facing summary format and omits notes deliberately. Use CSV or XLSX.',
    title: 'PDF export omits the notes column by design',
    issueSummary: 'Notes are intentionally excluded from the client-facing PDF export; CSV and XLSX include them.',
    reproSteps:
      '1. Export a timesheet as PDF. 2. Observe no Notes column. 3. Export the same range as CSV; notes are present.',
    severity: 'low',
    productArea: 'exports',
    rootCause: 'PDF is designed for sharing with clients, where internal notes should not appear.',
    nextAction: 'Recommend CSV for internal review and note the rationale in the exports doc.',
    ageDays: 45,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.86, reproSteps: 0.84, severity: 0.58, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Our scheduled export runs at 6am but we are in Sydney and it lands mid-afternoon.\nAgent: Schedules run at 06:00 in the workspace time zone, which is set to London for you.',
    title: 'Scheduled export fires at the wrong local time for a remote team',
    issueSummary:
      'A scheduled export appeared to run at the wrong time because schedules use the workspace time zone, which did not match the team location.',
    reproSteps:
      '1. Set workspace time zone to Europe/London. 2. Schedule a weekly export. 3. It fires at 06:00 London, not local.',
    severity: 'low',
    productArea: 'exports',
    rootCause: 'Schedules intentionally follow the workspace time zone so all members see one consistent cadence.',
    nextAction: 'Change the workspace time zone or accept the offset; log a request for per-schedule time zones.',
    ageDays: 47,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.87, reproSteps: 0.85, severity: 0.6, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Importer rejected our file with "unknown column".\nAgent: The importer expects Date, Email, Project, Task, Hours, Billable, Notes. Extra columns are rejected rather than ignored.',
    title: 'Import rejects files containing extra columns',
    issueSummary:
      'A CSV import failed because it contained columns beyond the documented set; unrecognised columns are an error, not a warning.',
    reproSteps: '1. Add a "Department" column to the import template. 2. Upload. 3. The import fails.',
    severity: 'medium',
    productArea: 'imports',
    rootCause: 'Strict column validation prevents silent data loss but is unforgiving of exported-from-elsewhere files.',
    nextAction: 'Strip the extra columns and request that unknown columns be warned about rather than fatal.',
    ageDays: 49,
    indexed: true,
    confidence: { title: 0.89, issueSummary: 0.9, reproSteps: 0.87, severity: 0.7, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: Invoice PDF changed between two downloads.\nAgent: Draft invoices re-render each time. Once issued, the PDF is frozen.',
    title: 'Draft invoice PDF differs between downloads',
    issueSummary:
      'Two downloads of the same draft invoice produced different PDFs because drafts render live and the underlying entries had changed.',
    reproSteps: '1. Download a draft invoice PDF. 2. Edit an underlying entry. 3. Download again; the PDF differs.',
    severity: 'low',
    productArea: 'billing',
    rootCause: 'Only issued invoices are frozen; drafts are intentionally live previews.',
    nextAction: 'Explain draft versus issued and recommend issuing before sharing a PDF externally.',
    ageDays: 51,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.86, reproSteps: 0.85, severity: 0.58, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Our accountant needs read access to invoices but not to timesheets.\nAgent: There is no finance-only role. Manager is the closest, and it can see all member data.',
    title: 'No finance-only role for accountants',
    issueSummary:
      'A customer needed invoice-only access for an external accountant; the role model offers Owner, Manager and Member, none of which is finance-scoped.',
    reproSteps: 'Not reproducible — a permissions model gap.',
    severity: 'medium',
    productArea: 'roles',
    rootCause: 'The three-role model has no finance scope, and portal access covers clients, not internal finance staff.',
    nextAction: 'Suggest exporting invoices for the accountant and log a request for a finance role.',
    ageDays: 53,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.91, reproSteps: 0.5, severity: 0.72, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Two members have the same name and approvals are confusing.\nAgent: Approvals are attributed by email, which is unique; the display name is not.',
    title: 'Duplicate display names make approval attribution ambiguous',
    issueSummary:
      'Two members sharing a display name made the approvals queue ambiguous, although attribution is by unique email underneath.',
    reproSteps:
      '1. Add two members with the same name. 2. Submit weeks for both. 3. The approvals queue shows two identical rows.',
    severity: 'low',
    productArea: 'approvals',
    rootCause: 'The approvals UI shows display name only; email is available but not rendered.',
    nextAction: 'Rename one member and request the email be shown alongside the name in the queue.',
    ageDays: 55,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.84, reproSteps: 0.86, severity: 0.57, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: Budget shows currency but our project is billed in hours.\nAgent: A budget is either hours or currency. Yours was created as currency; that cannot be switched after entries exist.',
    title: 'Budget type cannot be switched between hours and currency',
    issueSummary:
      'A project budget created in currency could not be converted to an hours budget once time had been logged against it.',
    reproSteps: '1. Create a currency budget. 2. Log time. 3. Try to change the budget type; the control is disabled.',
    severity: 'low',
    productArea: 'budgets',
    rootCause: 'Switching type would invalidate historical alert state, so it is blocked once progress exists.',
    nextAction: 'Create a fresh project with the right budget type, or accept the currency budget for this engagement.',
    ageDays: 57,
    usefulness: 'not_useful',
    confidence: { title: 0.82, issueSummary: 0.83, reproSteps: 0.8, severity: 0.56, productArea: 0.86 },
  },
  {
    transcript:
      'Customer: Reminder emails are landing in spam for our whole domain.\nAgent: Your mail provider is scoring us low. Allow-listing our sending domain resolves it.',
    title: 'Reminder emails filtered to spam across a customer domain',
    issueSummary:
      'A customer mail provider filtered Helio Labs notification email domain-wide, so reminders and approval notices went unseen.',
    reproSteps: '1. Trigger a reminder email. 2. Check the recipient spam folder. 3. The message is present and marked spam.',
    severity: 'medium',
    productArea: 'notifications',
    rootCause: 'Recipient-side reputation filtering; nothing in the application is failing.',
    nextAction: 'Send SPF/DKIM details and ask their IT team to allow-list the sending domain.',
    ageDays: 59,
    indexed: true,
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.83, severity: 0.71, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Can we get a webhook when a budget hits 80%?\nAgent: Budget thresholds send email and in-app notifications only; there is no webhook event for them.',
    title: 'No webhook event for budget threshold alerts',
    issueSummary: 'Budget threshold alerts are delivered by email and in-app only; the webhook event list does not include them.',
    reproSteps: 'Not reproducible — a missing capability.',
    severity: 'low',
    productArea: 'api-webhooks',
    rootCause: 'The webhook event set covers time entries, timesheets and invoices, and was never extended to budgets.',
    nextAction: 'Suggest polling the project endpoint as an interim and log a feature request.',
    ageDays: 61,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.88, reproSteps: 0.5, severity: 0.58, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: We want to stop members seeing each other rates.\nAgent: Members already cannot see other members rates. Managers can, and there is no way to restrict that.',
    title: 'Managers can always see every member rate',
    issueSummary:
      'A customer wanted rate visibility restricted among managers; the role model grants all managers full visibility of member data including rates.',
    reproSteps: 'Not reproducible — a permissions model constraint.',
    severity: 'medium',
    productArea: 'roles',
    rootCause: 'Manager is defined as full visibility over member data; there is no per-field permission layer.',
    nextAction: 'Confirm the constraint and log a request for rate-visibility scoping.',
    ageDays: 63,
    usefulness: 'useful',
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.5, severity: 0.74, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Timesheet totals differ between the web app and the CSV.\nAgent: The web app shows raw durations; the CSV applies the workspace rounding rule.',
    title: 'Web totals and exported totals differ because of rounding',
    issueSummary:
      'The timesheet screen shows unrounded durations while exports apply the workspace rounding rule, producing different totals for the same week.',
    reproSteps:
      '1. Set rounding to nearest 15. 2. Log several short entries. 3. Compare the on-screen total with the CSV total.',
    severity: 'medium',
    productArea: 'exports',
    rootCause: 'Rounding is applied at reporting and export time, not to the stored entry, and the screen shows the stored value.',
    nextAction: 'Explain where rounding applies and request a rounded-total toggle on the timesheet.',
    ageDays: 65,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.92, reproSteps: 0.88, severity: 0.72, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Our SSO test worked but enforcement broke service accounts.\nAgent: Enforcement disables password login for everyone except the Owner, including any service account you created as a member.',
    title: 'SSO enforcement broke API service accounts created as members',
    issueSummary:
      'Service accounts implemented as ordinary members lost access when SSO enforcement disabled password login for all non-owner accounts.',
    reproSteps: '1. Create a member to act as a service account. 2. Enforce SSO. 3. That account can no longer authenticate.',
    severity: 'high',
    productArea: 'auth-sso',
    rootCause: 'Service accounts are not a first-class concept; API keys exist for that purpose but were not used.',
    nextAction: 'Migrate the integration to a workspace API key, which is unaffected by SSO enforcement.',
    ageDays: 67,
    indexed: true,
    confidence: { title: 0.93, issueSummary: 0.94, reproSteps: 0.89, severity: 0.9, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: Deleting a tag removed it from entries. Did we lose data?\nAgent: Only the label was removed. The entries and their hours are untouched.',
    title: 'Concern that deleting a tag deletes tagged entries',
    issueSummary:
      'A customer feared data loss after deleting a workspace tag; deletion removes the label from entries and nothing else.',
    reproSteps: '1. Tag several entries. 2. Delete the tag. 3. Entries remain with the tag removed.',
    severity: 'low',
    productArea: 'tags',
    rootCause: 'The delete confirmation does not state that entries are preserved.',
    nextAction: 'Reassure the customer and request clearer confirmation copy.',
    ageDays: 69,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.85, reproSteps: 0.86, severity: 0.55, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Our EU workspace needs to move to the US region.\nAgent: Region is fixed at creation. Moving means a full export and re-import into a new workspace.',
    title: 'Workspace region cannot be changed after creation',
    issueSummary:
      'A customer needed to relocate their workspace from the EU to the US region; region is immutable and requires export and re-import into a new workspace.',
    reproSteps: 'Not reproducible — a platform constraint.',
    severity: 'medium',
    productArea: 'data-retention',
    rootCause: 'Data residency is enforced by physically separate clusters, so migration is a data move, not a setting.',
    nextAction: 'Scope the export/re-import, warning that invoice history and audit log do not transfer.',
    ageDays: 71,
    indexed: true,
    confidence: { title: 0.91, issueSummary: 0.92, reproSteps: 0.5, severity: 0.78, productArea: 0.93 },
  },
  {
    transcript:
      'Customer: Approval reminder went to a manager who left.\nAgent: Approver notifications go to everyone with the Manager role. That account had not been removed.',
    title: 'Approval notifications sent to a departed manager still holding the role',
    issueSummary:
      'Approval queue notifications continued reaching a departed employee because their account retained the Manager role.',
    reproSteps:
      '1. Leave a departed member with the Manager role. 2. Submit a week. 3. They receive the approval notification.',
    severity: 'medium',
    productArea: 'notifications',
    rootCause: 'Nothing prompts an offboarding review of roles; notifications simply follow the role.',
    nextAction: 'Remove the member and recommend an offboarding checklist covering roles, sessions and billing contact.',
    ageDays: 73,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.88, reproSteps: 0.85, severity: 0.7, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Report grouped by day is missing weekends entirely.\nAgent: Days with no entries are omitted rather than shown as zero.',
    title: 'Report grouped by day omits days with no entries',
    issueSummary:
      'A day-grouped report skipped days without entries instead of showing zero rows, which broke the customer downstream spreadsheet.',
    reproSteps: '1. Log time on weekdays only. 2. Run a report grouped by day for a full week. 3. Weekend rows are absent.',
    severity: 'low',
    productArea: 'reporting',
    rootCause: 'Grouping is derived from existing entries, so empty buckets never materialise.',
    nextAction: 'Suggest filling gaps downstream and log a request for a show-empty-days option.',
    ageDays: 75,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.87, reproSteps: 0.86, severity: 0.58, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: A member can still log time to a project after we restricted it.\nAgent: Restricting hides it from unassigned members going forward. They were already assigned.',
    title: 'Restricting a project does not remove already-assigned members',
    issueSummary:
      'Making a project Restricted did not revoke access for members who were already assigned to it, which the customer expected.',
    reproSteps: '1. Assign a member to an Open project. 2. Switch it to Restricted. 3. The member retains access.',
    severity: 'medium',
    productArea: 'roles',
    rootCause: 'Restriction changes visibility rules for unassigned members; it does not clear the assignment list.',
    nextAction: 'Unassign the members who should lose access and request that the dialog say so.',
    ageDays: 77,
    indexed: true,
    confidence: { title: 0.89, issueSummary: 0.9, reproSteps: 0.87, severity: 0.75, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: We were charged for a seat we removed mid-month.\nAgent: Removing a member frees the seat at the end of the current billing period, not immediately.',
    title: 'Seat billed for the remainder of the period after member removal',
    issueSummary:
      'A customer expected an immediate credit after removing a member; seats are released at the end of the billing period.',
    reproSteps: '1. Remove a member mid-period. 2. Check the next invoice. 3. The seat is still billed for that period.',
    severity: 'low',
    productArea: 'billing',
    rootCause: 'Seat release is period-aligned to avoid proration churn.',
    nextAction: 'Explain the policy and point to the plan documentation.',
    ageDays: 79,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.86, reproSteps: 0.84, severity: 0.6, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Custom field values are missing from the CSV export.\nAgent: Custom fields are included only in the XLSX export today.',
    title: 'Custom field values absent from CSV exports',
    issueSummary: 'Custom field values appear in XLSX exports but not in CSV, which the customer was relying on.',
    reproSteps: '1. Add a custom field with values. 2. Export CSV. 3. No custom field columns are present.',
    severity: 'medium',
    productArea: 'exports',
    rootCause: 'CSV export uses a fixed column set that predates custom fields.',
    nextAction: 'Recommend XLSX and file a gap for custom fields in CSV.',
    ageDays: 81,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.89, reproSteps: 0.88, severity: 0.7, productArea: 0.92 },
  },
  {
    transcript:
      'Customer: The audit log does not cover time entry deletion.\nAgent: Correct — deletions of entries are not audited today, only approvals and settings changes.',
    title: 'Time entry deletions are not recorded in the audit log',
    issueSummary:
      'Entry deletions leave no audit trail, so a customer could not determine who removed a week of a contractor time.',
    reproSteps: '1. Delete entries. 2. Search the audit log. 3. No record of the deletion exists.',
    severity: 'high',
    productArea: 'audit',
    rootCause: 'The audit scope covers approvals, rates, roles, invoices and settings, and never included entry mutations.',
    nextAction: 'Escalate as a compliance gap; deletions of financial source data should be audited.',
    ageDays: 83,
    indexed: true,
    confidence: { title: 0.93, issueSummary: 0.92, reproSteps: 0.86, severity: 0.89, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Bulk tag change silently skipped some entries.\nAgent: Entries in submitted weeks are skipped by bulk operations. There was no message about it.',
    title: 'Bulk tag change skips locked entries without reporting it',
    issueSummary:
      'A bulk tag update silently skipped entries in submitted weeks, so the customer believed the operation had fully applied.',
    reproSteps:
      '1. Select entries spanning a draft and a submitted week. 2. Bulk-apply a tag. 3. Only the draft entries change, with no warning.',
    severity: 'medium',
    productArea: 'tags',
    rootCause: 'The bulk path filters locked entries out before applying and does not report the skipped count.',
    nextAction: 'File a bug for a skipped-count summary after every bulk operation.',
    ageDays: 85,
    indexed: true,
    confidence: { title: 0.91, issueSummary: 0.9, reproSteps: 0.89, severity: 0.73, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: Invoice went to the old billing contact after we changed owner.\nAgent: The billing contact is separate from the workspace owner and has to be updated on its own.',
    title: 'Subscription invoice sent to a stale billing contact after ownership transfer',
    issueSummary:
      'Transferring workspace ownership did not update the subscription billing contact, so invoices continued to reach a departed employee.',
    reproSteps: '1. Transfer ownership. 2. Wait for the next subscription invoice. 3. It is sent to the previous billing contact.',
    severity: 'medium',
    productArea: 'billing',
    rootCause: 'Owner and billing contact are intentionally separate fields, with no prompt to reconcile them.',
    nextAction: 'Update the billing contact and request that ownership transfer prompt for it.',
    ageDays: 87,
    indexed: true,
    confidence: { title: 0.89, issueSummary: 0.91, reproSteps: 0.85, severity: 0.72, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Portal contact cannot download the invoice PDF.\nAgent: Portal shows issued invoices but PDF download is not enabled for portal users.',
    title: 'Client portal shows invoices but does not allow PDF download',
    issueSummary:
      'Portal users can see issued invoices but have no download control, so the customer had to email PDFs manually.',
    reproSteps: '1. Grant portal access. 2. Open an issued invoice in the portal. 3. No download option is present.',
    severity: 'low',
    productArea: 'client-portal',
    rootCause: 'Portal is read-only by design and file download was never added to its capability set.',
    nextAction: 'Email the PDF and log a request for portal downloads.',
    ageDays: 89,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.87, reproSteps: 0.85, severity: 0.58, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Two-factor is required but a new hire cannot enrol.\nAgent: Enrolment happens at first sign-in. They had an invitation link that had already expired.',
    title: 'Expired invitation blocks 2FA enrolment for a new hire',
    issueSummary: 'A new member could not enrol in required 2FA because their invitation had expired before first sign-in.',
    reproSteps: '1. Require 2FA. 2. Invite a member. 3. Wait more than 7 days. 4. The link is dead and enrolment never starts.',
    severity: 'low',
    productArea: 'auth-sso',
    rootCause: 'Invitations expire after 7 days; the expiry message does not mention resending.',
    nextAction: 'Resend the invitation, which invalidates the old link, and note the 7-day window.',
    ageDays: 91,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.86, reproSteps: 0.87, severity: 0.57, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Utilization dropped 20% overnight with no change in hours.\nAgent: Capacity was raised from 32 to 40 for six members last night, which changes the denominator.',
    title: 'Utilization drop caused by a capacity change, not a drop in hours',
    issueSummary:
      'Team utilization fell sharply because member capacities were increased, enlarging the denominator while hours stayed flat.',
    reproSteps: '1. Note utilization. 2. Increase capacity for several members. 3. Utilization drops with no change in logged hours.',
    severity: 'medium',
    productArea: 'reporting',
    rootCause: 'Capacity changes apply to historical reporting periods as well as future ones.',
    nextAction: 'Explain the denominator effect and request that capacity changes be dated.',
    ageDays: 93,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.92, reproSteps: 0.88, severity: 0.74, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: Expense receipts are not visible to our accountant.\nAgent: Receipt images are visible to Managers and Owners. Your accountant is a Member.',
    title: 'Expense receipts hidden from members',
    issueSummary: 'Receipt images attached to expenses are visible only to Managers and Owners, not to Members.',
    reproSteps: '1. Attach a receipt to an expense. 2. Sign in as a Member. 3. The receipt is not shown.',
    severity: 'low',
    productArea: 'expenses',
    rootCause: 'Receipts can contain personal data, so visibility is restricted to elevated roles.',
    nextAction: 'Promote the accountant to Manager or export the receipts; note the finance-role gap.',
    ageDays: 95,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.85, reproSteps: 0.84, severity: 0.58, productArea: 0.88 },
  },
  {
    transcript:
      'Customer: Our workspace search returns nothing for a client we definitely have.\nAgent: The client is archived, and archived records are excluded from search.',
    title: 'Archived clients excluded from workspace search',
    issueSummary: 'Search returned no results for an archived client, because archived records are filtered out of the search index.',
    reproSteps: '1. Archive a client. 2. Search for its name. 3. No results.',
    severity: 'low',
    productArea: 'search',
    rootCause: 'Archived records are deliberately excluded from pickers and search, though they remain reportable.',
    nextAction: 'Unarchive if it is still active, or use reports for historical lookups.',
    ageDays: 97,
    usefulness: 'useful',
    confidence: { title: 0.85, issueSummary: 0.86, reproSteps: 0.85, severity: 0.56, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: The desktop app shows a sync error for one entry and we cannot clear it.\nAgent: That entry landed in a week that was approved while it was queued offline, so it is rejected.',
    title: 'Offline entry rejected because its week was approved while queued',
    issueSummary:
      'A desktop sync error persisted because the queued offline entry targeted a week that had been approved in the meantime, and rejected entries are surfaced rather than dropped.',
    reproSteps:
      '1. Log an entry offline. 2. Have a manager approve that week. 3. Reconnect; the entry is rejected with a sync error.',
    severity: 'medium',
    productArea: 'desktop-app',
    rootCause: 'Approved weeks are immutable, and the desktop app deliberately surfaces the rejection instead of discarding data.',
    nextAction: 'Reopen the week, let the entry sync, then re-approve.',
    ageDays: 99,
    indexed: true,
    confidence: { title: 0.91, issueSummary: 0.92, reproSteps: 0.89, severity: 0.75, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Can we bulk import clients and projects, not just time?\nAgent: The importer covers time entries only. Clients and projects have to be created through the UI or API.',
    title: 'No bulk import for clients and projects',
    issueSummary:
      'A customer migrating from another tool could import time entries but had to create clients and projects manually or via the API.',
    reproSteps: 'Not reproducible — a missing capability.',
    severity: 'medium',
    productArea: 'imports',
    rootCause: 'The importer was scoped to time entries; structural records were left to the API.',
    nextAction: 'Provide an API script for the structure import and log a request for structural CSV import.',
    ageDays: 101,
    indexed: true,
    confidence: { title: 0.89, issueSummary: 0.9, reproSteps: 0.5, severity: 0.72, productArea: 0.91 },
  },
  {
    transcript:
      'Customer: The 2FA requirement is not being enforced for one member.\nAgent: They sign in through SSO. Enforcement covers password login; the identity provider owns MFA for SSO users.',
    title: 'Workspace 2FA requirement does not apply to SSO members',
    issueSummary:
      'Workspace-level 2FA enforcement applies to password sign-in only; members authenticating through SAML rely on their identity provider MFA.',
    reproSteps: '1. Require 2FA. 2. Sign in as an SSO member. 3. No enrolment is requested.',
    severity: 'medium',
    productArea: 'auth-sso',
    rootCause: 'MFA for federated identities is the identity provider responsibility by design.',
    nextAction: 'Confirm MFA is enforced in their IdP and note the split in the security documentation.',
    ageDays: 103,
    indexed: true,
    confidence: { title: 0.92, issueSummary: 0.93, reproSteps: 0.87, severity: 0.78, productArea: 0.95 },
  },
  {
    transcript:
      'Customer: We need a report of every rate change last year.\nAgent: The audit log covers rate changes and can be filtered by date and exported.',
    title: 'Request for a historical rate-change report',
    issueSummary:
      'A customer needed evidence of every rate change over a year; the audit log covers rate changes and can be filtered and exported.',
    reproSteps: 'Not a defect — a how-to request.',
    severity: 'low',
    productArea: 'audit',
    rootCause: 'Not applicable — the capability exists but is not discoverable from the billing screens.',
    nextAction: 'Show the audit log filter and export, and note the discoverability gap.',
    ageDays: 105,
    usefulness: 'useful',
    confidence: { title: 0.83, issueSummary: 0.85, reproSteps: 0.5, severity: 0.55, productArea: 0.86 },
  },
  {
    transcript:
      'Customer: Invoice rounding produced a one cent difference against our accounting system.\nAgent: We round hours per entry, then multiply by the rate. Your system multiplies first, then rounds currency.',
    title: 'One cent invoice discrepancy from rounding order',
    issueSummary:
      'A penny-level mismatch arose because Helio Labs rounds hours before applying the rate, while the customer accounting system rounds the resulting currency.',
    reproSteps:
      '1. Log entries that round non-trivially. 2. Generate an invoice. 3. Compare the total with the same data in the external system.',
    severity: 'low',
    productArea: 'billing',
    rootCause: 'Rounding order differs between systems; neither is wrong, but they are not interchangeable.',
    nextAction: 'Document the rounding order so finance teams can reconcile deliberately.',
    ageDays: 107,
    indexed: true,
    confidence: { title: 0.88, issueSummary: 0.91, reproSteps: 0.84, severity: 0.6, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: New members default to seeing every open project. We want the opposite.\nAgent: Open projects are visible to all members by design. Restricted projects are opt-in per member.',
    title: 'No workspace default for restricted project visibility',
    issueSummary:
      'A customer wanted new members to start with no project access; Open projects are visible to everyone and there is no workspace-wide default to restrict them.',
    reproSteps: 'Not reproducible — a configuration gap.',
    severity: 'medium',
    productArea: 'roles',
    rootCause: 'Visibility is per project, with no workspace-level default to make every new project Restricted.',
    nextAction: 'Switch the sensitive projects to Restricted and log a request for a workspace default.',
    ageDays: 109,
    usefulness: 'useful',
    confidence: { title: 0.87, issueSummary: 0.88, reproSteps: 0.5, severity: 0.7, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Digest email arrived empty this week.\nAgent: The digest skips sections with no activity. Your workspace had no new documents or tickets that week.',
    title: 'Digest email arrives with empty sections omitted',
    issueSummary:
      'A weekly digest looked broken because sections with no activity are omitted entirely rather than shown as zero.',
    reproSteps: '1. Have a week with no activity. 2. Wait for the digest. 3. The email arrives with little or no content.',
    severity: 'low',
    productArea: 'notifications',
    rootCause: 'Empty sections are suppressed to keep the digest short, which makes a quiet week look like a failure.',
    nextAction: 'Explain the suppression and suggest a "nothing happened" line for quiet weeks.',
    ageDays: 111,
    usefulness: 'not_useful',
    confidence: { title: 0.82, issueSummary: 0.84, reproSteps: 0.8, severity: 0.55, productArea: 0.87 },
  },
  {
    transcript:
      'Customer: Our Slack digest webhook stopped working after we rotated it.\nAgent: The webhook URL is stored, not refreshed. Paste the new URL in the digest settings.',
    title: 'Slack digest silently stops after the webhook URL is rotated',
    issueSummary:
      'Digest delivery to Slack stopped when the customer rotated the incoming webhook URL, and the failure produced no notification.',
    reproSteps: '1. Configure a Slack webhook. 2. Rotate it in Slack. 3. The next digest fails silently.',
    severity: 'medium',
    productArea: 'notifications',
    rootCause: 'Digest delivery failures are recorded on the background run but not surfaced to the workspace owner.',
    nextAction: 'Update the URL and file a request to notify on repeated digest delivery failure.',
    ageDays: 113,
    indexed: true,
    confidence: { title: 0.9, issueSummary: 0.91, reproSteps: 0.87, severity: 0.72, productArea: 0.89 },
  },
  {
    transcript:
      'Customer: Can support see our time entry notes?\nAgent: Yes, support access covers workspace data and every access is logged. We do not read notes without a reason tied to a ticket.',
    title: 'Question about support access to workspace data',
    issueSummary:
      'A customer asked what support staff can see; support can access workspace data including notes, and every access is logged and tied to a ticket.',
    reproSteps: 'Not a defect — a trust and transparency question.',
    severity: 'low',
    productArea: 'data-retention',
    rootCause: 'Not applicable.',
    nextAction: 'Send the access-logging policy and offer to provide an access report on request.',
    ageDays: 115,
    usefulness: 'useful',
    confidence: { title: 0.84, issueSummary: 0.86, reproSteps: 0.5, severity: 0.55, productArea: 0.85 },
  },
  {
    transcript:
      'Customer: We deleted a project by accident.\nAgent: Deletion is only possible when no time was ever logged, so nothing billable was lost. The project itself cannot be restored.',
    title: 'Accidentally deleted an empty project',
    issueSummary:
      'A project was deleted in error; deletion is only permitted for projects with no logged time, so no historical data was affected.',
    reproSteps: '1. Create a project with no entries. 2. Delete it. 3. It is gone with no restore option.',
    severity: 'low',
    productArea: 'projects',
    rootCause: 'Hard delete is allowed precisely because the record carries no history.',
    nextAction: 'Recreate the project and recommend archiving instead of deleting as a habit.',
    ageDays: 117,
    usefulness: 'useful',
    confidence: { title: 0.83, issueSummary: 0.85, reproSteps: 0.86, severity: 0.55, productArea: 0.84 },
  },
  {
    transcript:
      'Customer: Reports are slow when we select the whole year.\nAgent: Year-long workspace-wide reports scan every entry. Narrowing by client or exporting async is faster.',
    title: 'Year-long workspace-wide reports are slow to render',
    issueSummary:
      'Full-year reports across the whole workspace take a long time to render because they aggregate every entry in range.',
    reproSteps: '1. Select a 12-month range with no filters. 2. Group by member. 3. The report takes noticeably longer.',
    severity: 'medium',
    productArea: 'reporting',
    rootCause: 'Reports aggregate live rather than from a pre-computed rollup.',
    nextAction: 'Recommend narrowing by client or using a queued export, and log the rollup idea.',
    ageDays: 119,
    indexed: true,
    confidence: { title: 0.88, issueSummary: 0.89, reproSteps: 0.85, severity: 0.7, productArea: 0.9 },
  },
  {
    transcript:
      'Customer: Timer kept running after my laptop slept for two hours.\nAgent: Expected — duration comes from the stored start time, so sleep does not stop it. The 12-hour prompt is the only guard.',
    title: 'Timer continues across a laptop sleep',
    issueSummary:
      'A timer accumulated time while the machine was asleep, because duration is derived from a server-side start timestamp rather than local activity.',
    reproSteps: '1. Start a timer. 2. Sleep the machine for two hours. 3. Wake it; the timer includes the sleep period.',
    severity: 'low',
    productArea: 'timers',
    rootCause: 'Server-side start timestamps make timers robust to crashes, at the cost of idle detection.',
    nextAction: 'Correct the entry and log a request for idle detection on the desktop app.',
    ageDays: 121,
    usefulness: 'useful',
    confidence: { title: 0.86, issueSummary: 0.88, reproSteps: 0.87, severity: 0.6, productArea: 0.89 },
  },
]
