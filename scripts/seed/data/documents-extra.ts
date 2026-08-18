// Second half of the demo corpus (58 more documents).
//
// Split into its own module purely for readability — documents.ts concatenates
// EXTRA_SPECS onto its own list, and everything downstream (ids, chunks,
// embeddings, events) treats the two identically. Same rule as the first half:
// real, internally consistent prose about the fictional Helio Labs product, so
// retrieval during a demo returns something a person would actually accept.
import { KB_HELP_CENTER_ID, KB_PRODUCT_DOCS_ID, KB_RUNBOOKS_ID } from '../config'
import type { DocSpec } from './documents'

export const EXTRA_SPECS: DocSpec[] = [
  // ------------------------------------------------------------ Product Docs
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Capacity and working hours',
    slug: 'capacity-working-hours',
    docType: 'md',
    ageDays: 62,
    sections: [
      [
        'Setting capacity',
        'Each member profile carries a weekly capacity in hours, defaulting to 40. Capacity drives utilization, the weekly reminder threshold, and the "under-logged" warning on the timesheet. Part-time members should carry their real number rather than zero — a zero capacity removes them from the utilization average entirely, which silently inflates the team figure.',
      ],
      [
        'Working days and holidays',
        'Working days are set per workspace and can be overridden per member, which matters for teams spread across regions with different weekends. Public holidays are imported from a country calendar and excluded from capacity for that week, so a three-day week does not read as under-logging.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Leave and time off',
    slug: 'leave-time-off',
    docType: 'md',
    ageDays: 57,
    sections: [
      [
        'Requesting leave',
        'Leave is requested from the member profile and approved by a Manager. Approved leave reduces that week capacity, suppresses reminder emails, and appears on the team calendar. Leave is deliberately not a project: logging holiday as time on a non-billable project inflates hours worked and leaves reminders firing at people on a beach.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Budgets and burn alerts',
    slug: 'budgets-burn-alerts',
    docType: 'md',
    ageDays: 44,
    sections: [
      [
        'Setting a budget',
        'A project can carry a budget in hours or in currency. Progress is measured against approved time only, so unapproved entries never trip an alert prematurely. Budgets can be recurring monthly for retainers or fixed for a one-off engagement.',
      ],
      [
        'Alert thresholds',
        'Alerts fire at 50%, 80% and 100% of budget, and again at 120% if you allow overage. Notifications go to the project manager and the workspace owner. Turning a budget off clears its alert state; it does not backfill missed alerts if you turn it on again later.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Expenses and reimbursements',
    slug: 'expenses',
    docType: 'md',
    ageDays: 49,
    sections: [
      [
        'Recording an expense',
        'Expenses attach to a project and carry an amount, a category, an optional receipt image, and a billable flag. Billable expenses flow onto the client invoice at cost or with a markup percentage set per project. Reimbursable expenses are tracked separately from billable ones — an expense can be either, both, or neither.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Custom fields',
    slug: 'custom-fields',
    docType: 'md',
    ageDays: 39,
    sections: [
      [
        'Defining fields',
        'Workspaces on the Business plan can add custom fields to projects, clients and time entries. Field types are text, number, single-select and date. A field can be marked required, which blocks saving an entry until it is filled — apply that carefully, because it also blocks the mobile app and the API.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Audit log',
    slug: 'audit-log',
    docType: 'md',
    ageDays: 52,
    sections: [
      [
        'What is recorded',
        'The audit log records who did what and when for approvals, rate changes, member role changes, invoice issue and void, project access changes, and workspace settings. Entries are immutable and retained for the life of the workspace. Time entry edits are recorded with both the actor and the affected member, which is what makes manager-entered time defensible during a client dispute.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Client portal',
    slug: 'client-portal',
    docType: 'md',
    ageDays: 36,
    sections: [
      [
        'Sharing progress with a client',
        'A client contact can be given read-only portal access showing approved hours, budget burn and issued invoices for their projects only. Portal users are not workspace members and do not consume a seat. They never see rates for other clients, internal projects, or unapproved time.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Notifications reference',
    slug: 'notifications-reference',
    docType: 'md',
    ageDays: 31,
    sections: [
      [
        'Notification types',
        'Helio Labs sends notifications for approval decisions, submission reminders, budget thresholds, integration failures, invoice issue, and invitation acceptance. Each type can be toggled per member from their profile, except integration failures, which always reach the workspace owner because they represent data loss risk.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Search across the workspace',
    slug: 'workspace-search',
    docType: 'md',
    ageDays: 29,
    sections: [
      [
        'What is searchable',
        'Search covers project names, client names, task names, entry notes and tags. It respects project visibility, so a Member never sees results from a Restricted project they are not assigned to. Search is prefix-matched on words rather than substring, so "invo" finds "invoice" but "voice" does not.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Keyboard shortcuts',
    slug: 'keyboard-shortcuts',
    docType: 'md',
    ageDays: 26,
    sections: [
      [
        'Common shortcuts',
        'Press S to start or stop the current timer, N to create a new entry on the selected day, and the arrow keys to move between days. Command-K opens workspace search from anywhere. Shortcuts are disabled while a text field has focus, so typing a note never starts a timer by accident.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Two-factor authentication',
    slug: 'two-factor-auth',
    docType: 'md',
    ageDays: 47,
    sections: [
      [
        'Enabling 2FA',
        'Members can enable time-based one-time password 2FA from their profile using any authenticator app. Owners can require it workspace-wide, which forces enrolment at next sign-in. Recovery codes are shown once at enrolment and are the only way back in if the device is lost — support cannot disable 2FA on request, because that would make it worthless.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Session and device management',
    slug: 'session-management',
    docType: 'md',
    ageDays: 43,
    sections: [
      [
        'Active sessions',
        'Each member can see their active sessions with device, approximate location and last-used time, and can revoke any of them. Owners can revoke all sessions for a member during offboarding. Revocation is immediate for the web app and takes effect at the next sync for the desktop and mobile apps, which cache a short-lived token.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Bulk operations',
    slug: 'bulk-operations',
    docType: 'md',
    ageDays: 24,
    sections: [
      [
        'What can be done in bulk',
        'From the timesheet you can multi-select entries and change their project, task, billable flag or tags in one action. Bulk delete is limited to entries in unsubmitted weeks. There is deliberately no bulk edit of hours — changing durations in bulk is the fastest way to make a timesheet indefensible.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Archiving vs deleting',
    slug: 'archive-vs-delete',
    docType: 'md',
    ageDays: 41,
    sections: [
      [
        'Choosing between them',
        'Archiving hides a client, project or task from pickers while keeping all historical time intact and reportable. Deleting is only permitted when no time has ever been logged against the record. If you need something gone and it has history, archive it — the delete button will stay disabled and that is intentional, not a bug.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Multi-currency billing',
    slug: 'multi-currency',
    docType: 'md',
    ageDays: 46,
    sections: [
      [
        'Currency per client',
        'Each client carries a billing currency. Rates entered on projects belonging to that client are in the client currency, and invoices are issued in it. Reports roll up to the workspace base currency using the exchange rate on the date each entry was created, not today rate, which keeps historical revenue figures stable.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Rate cards',
    slug: 'rate-cards',
    docType: 'md',
    ageDays: 38,
    sections: [
      [
        'Reusable rate sets',
        'A rate card is a named set of role-to-rate mappings that can be applied to a project in one step, instead of setting each rate by hand. Updating a rate card does not change projects that already use it — application copies the values, so an old engagement keeps the rates it was sold at.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Timesheet locking policy',
    slug: 'timesheet-locking',
    docType: 'md',
    ageDays: 33,
    sections: [
      [
        'Automatic locking',
        'Owners can lock all weeks older than a chosen number of days, so historical timesheets stop drifting after the books close. Locking is independent of approvals: a week can be locked without ever having been approved. Owners can unlock a specific week, and every unlock is written to the audit log with a required reason.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Slack and Teams notifications',
    slug: 'slack-teams',
    docType: 'md',
    ageDays: 20,
    sections: [
      [
        'Current state',
        'Digest delivery to an incoming Slack webhook is supported at the workspace level. Per-event Slack notifications and any Microsoft Teams delivery are not implemented today; the roadmap tracks them but nothing in the product sends them, so do not promise either to a customer.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Data residency',
    slug: 'data-residency',
    docType: 'md',
    ageDays: 66,
    sections: [
      [
        'Where data lives',
        'Workspace data is stored in the region chosen at workspace creation, either EU (Frankfurt) or US (Virginia). The region cannot be changed afterwards without a full export and re-import into a new workspace. Backups stay within the same region, and support access is logged regardless of region.',
      ],
    ],
  },
  {
    kb: KB_PRODUCT_DOCS_ID,
    title: 'Service level targets',
    slug: 'service-levels',
    docType: 'md',
    ageDays: 71,
    sections: [
      [
        'Availability and response',
        'The published availability target is 99.9% monthly for the API and web app, measured excluding announced maintenance windows. Business plan workspaces have a four-hour first-response target during business hours; Starter and Team are next-business-day. Availability credits are requested through support and applied to the following invoice.',
      ],
    ],
  },

  // ------------------------------------------------------------ Help Center
  {
    kb: KB_HELP_CENTER_ID,
    title: 'My timer disappeared',
    slug: 'timer-disappeared',
    docType: 'html',
    sourceType: 'web',
    ageDays: 15,
    sections: [
      [
        'Where it went',
        'A running timer is stored server-side, so it survives a refresh or a crash. If it vanished, the most likely causes are that you started a timer on another device (which stops the first one and saves it), or the entry was saved and is now sitting in today list rather than in the timer bar. Check today entries before assuming the time was lost.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'I cannot see a project in the picker',
    slug: 'project-not-in-picker',
    docType: 'html',
    sourceType: 'web',
    ageDays: 19,
    sections: [
      [
        'Three reasons',
        'A project is missing from your picker if it is archived, if it is Restricted and you are not assigned, or if its client is archived. Managers can check all three from Project Settings. Assigning yourself makes it appear immediately; no sign-out is needed.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Changing your email address',
    slug: 'changing-email',
    docType: 'html',
    sourceType: 'web',
    ageDays: 23,
    sections: [
      [
        'How to change it',
        'Change your email from your profile; a confirmation link goes to the new address and the change takes effect once you click it. If your workspace uses SAML, change the address in Helio Labs first and then in your identity provider — doing it the other way round creates a second, empty user because the email is the identity key.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Why did I get a reminder email?',
    slug: 'why-reminder',
    docType: 'html',
    sourceType: 'web',
    ageDays: 25,
    sections: [
      [
        'Reminder logic',
        'Reminders go to members who have logged fewer hours than their capacity by the configured day and hour, and who have not yet submitted the week. They are skipped for approved leave. If you are being reminded while on holiday, the leave was probably logged as time on a project rather than as an approved leave record.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'How do I correct an approved entry?',
    slug: 'correct-approved-entry',
    docType: 'html',
    sourceType: 'web',
    ageDays: 17,
    sections: [
      [
        'The path',
        'Approved entries are locked. Ask an Owner to reopen the week, make the correction, then resubmit and re-approve. If the hours have already been invoiced, the invoice does not change automatically — it has to be credited or edited separately, which is deliberate so historical billing stays reproducible.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Exporting a single project',
    slug: 'export-single-project',
    docType: 'html',
    sourceType: 'web',
    ageDays: 13,
    sections: [
      [
        'Filter first',
        'Exports respect the filters active when you run them, so filter the timesheet or report to one project and then export. This is also the workaround when a large export hits the 50,000-row cap: split by project or by quarter rather than exporting the whole workspace at once.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Understanding the utilization figure',
    slug: 'understanding-utilization',
    docType: 'html',
    sourceType: 'web',
    ageDays: 28,
    sections: [
      [
        'How it is calculated',
        'Utilization is billable hours divided by capacity. Non-billable internal work still counts toward hours logged but not toward billable hours, so a week full of internal meetings shows low utilization and full logging. Members with zero capacity are excluded from the team average rather than counted as zero.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Adding a client contact',
    slug: 'adding-client-contact',
    docType: 'html',
    sourceType: 'web',
    ageDays: 32,
    sections: [
      [
        'Contacts and portal access',
        'Client contacts hold the name and email used on invoices and can optionally be granted read-only portal access. Portal contacts do not consume a seat and cannot see any project they are not attached to. Removing a contact revokes their portal access immediately.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'What happens when I remove a member?',
    slug: 'removing-a-member',
    docType: 'html',
    sourceType: 'web',
    ageDays: 37,
    sections: [
      [
        'Their data stays',
        'Removing a member revokes their access immediately and frees the seat at the end of the billing period. Their historical time is not deleted; it is reassigned to a placeholder "Removed member" so reports and invoices stay correct. This is why hours can look missing when a report is grouped by member — group by project to see them.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Invoice does not match my report',
    slug: 'invoice-vs-report',
    docType: 'html',
    sourceType: 'web',
    ageDays: 21,
    sections: [
      [
        'Three usual causes',
        'Invoices draw only from approved, billable, un-invoiced time, while a report can include unapproved and non-billable hours. Invoices also use rounded hours. And an issued invoice is frozen, so later edits to the underlying entries change the report but never the invoice. Compare like for like before assuming a bug.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Setting up your first workspace',
    slug: 'first-workspace',
    docType: 'html',
    sourceType: 'web',
    ageDays: 88,
    sections: [
      [
        'The five-minute version',
        'Create a client, add a project under it, add one or two tasks, invite your team, then set the workspace time zone and rounding rule before anyone logs time. Changing the time zone later is display-only and safe, but changing rounding after invoicing has started will change what un-invoiced periods bill at.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Mobile push notifications are not arriving',
    slug: 'mobile-push',
    docType: 'html',
    sourceType: 'web',
    ageDays: 16,
    sections: [
      [
        'Checklist',
        'Confirm notifications are enabled for Helio Labs in the device settings, that the member has not opted out in their profile, and that they are signed in to the right workspace on that device. Push is best-effort: approval decisions and reminders are always also visible in-app, so a missing push is never lost information.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Using tags for overtime tracking',
    slug: 'tags-overtime',
    docType: 'html',
    sourceType: 'web',
    ageDays: 30,
    sections: [
      [
        'A common pattern',
        'Create an "overtime" tag and apply it to entries beyond contracted hours, then report grouped by tag. This keeps overtime visible without creating a parallel project structure. Renaming the tag later updates every entry that uses it.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Downloading an invoice PDF',
    slug: 'invoice-pdf',
    docType: 'html',
    sourceType: 'web',
    ageDays: 26,
    sections: [
      [
        'Where to find it',
        'Open the invoice and choose Download PDF. Issued invoices keep a frozen PDF that always matches what the client received; draft invoices render a fresh preview each time, which is why a draft PDF can change between downloads.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Rejected timesheet — what now?',
    slug: 'rejected-timesheet',
    docType: 'html',
    sourceType: 'web',
    ageDays: 14,
    sections: [
      [
        'Next steps',
        'A rejection unlocks the week and attaches the approver comment. Fix what was flagged and submit again — there is no limit on resubmissions. Rejected entries return to draft, which is one of the common reasons hours appear to vanish from a report filtered to approved time.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Can two people share a login?',
    slug: 'shared-login',
    docType: 'html',
    sourceType: 'web',
    ageDays: 54,
    sections: [
      [
        'No, and why',
        'A login represents one person, because approvals, audit entries and utilization are all attributed to it. A shared account makes timesheets undefensible in a client dispute and breaks the rule that nobody approves their own week. Add a second member instead; seats are billed only from acceptance.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Time entry notes are missing from my export',
    slug: 'notes-missing-export',
    docType: 'html',
    sourceType: 'web',
    ageDays: 11,
    sections: [
      [
        'Check the format',
        'CSV and XLSX exports include the Notes column. The PDF summary export deliberately omits notes, because it is designed to be client-facing. If notes are blank in a CSV, the entries genuinely have none — the importer also leaves Notes empty when the source column is absent.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'How long do you keep deleted data?',
    slug: 'deleted-data-retention',
    docType: 'html',
    sourceType: 'web',
    ageDays: 61,
    sections: [
      [
        'Retention windows',
        'A deleted workspace is recoverable for 30 days and purged afterwards with no restore path. Deleted time entries are removed immediately and are not recoverable. Deleted members are anonymized rather than erased, so their historical hours survive on reports and invoices.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Connecting Helio Labs to Zapier',
    slug: 'zapier',
    docType: 'html',
    sourceType: 'web',
    ageDays: 35,
    sections: [
      [
        'Using the API instead',
        'There is no official Zapier app. Customers wire up automations through the REST API and webhooks, authenticating with a read-only or read-write workspace API key. Webhook payloads are HMAC-signed, so any intermediary must verify the signature before trusting the body.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Why is my export taking so long?',
    slug: 'slow-export',
    docType: 'html',
    sourceType: 'web',
    ageDays: 10,
    sections: [
      [
        'Queueing rules',
        'CSV exports up to 90 days run immediately. Longer ranges, and all XLSX and PDF exports, are queued and emailed when they finish. During a queue backlog these can take considerably longer than usual; support can see the queue depth and tell you whether the delay is your export or ours.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Approving on behalf of another manager',
    slug: 'approving-for-manager',
    docType: 'html',
    sourceType: 'web',
    ageDays: 18,
    sections: [
      [
        'Any manager can approve',
        'Approval is not assigned to a specific manager, so any Manager or the Owner can clear the queue when someone is away. The only hard rule is that nobody approves their own week. The audit log records which manager actually approved.',
      ],
    ],
  },
  {
    kb: KB_HELP_CENTER_ID,
    title: 'Billing contact and invoice delivery',
    slug: 'billing-contact',
    docType: 'html',
    sourceType: 'web',
    ageDays: 42,
    sections: [
      [
        'Where our invoices go',
        'Helio Labs invoices for your own subscription go to the billing contact set in Settings → Billing, which is separate from the workspace owner. Update it during offboarding — a departed owner address is the most common reason a customer misses a failed-payment notice.',
      ],
    ],
  },

  // ------------------------------------------------------------ Runbooks
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: database connection pool exhaustion',
    slug: 'runbook-pool-exhaustion',
    docType: 'md',
    ageDays: 9,
    sections: [
      [
        'Symptoms',
        'Requests time out with connection acquisition errors while CPU stays low. Check active connections against the pool ceiling first; the usual trigger is export workers scaled past 16 replicas, each holding connections for long-running reads.',
      ],
      [
        'Mitigation',
        'Scale export workers back to 8 and let in-flight jobs drain. Do not raise the pool ceiling as a first move — that pushes the bottleneck into the database itself, where it is much harder to recover from. Once stable, look for a single oversized export holding a connection.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: stuck Bull jobs',
    slug: 'runbook-stuck-jobs',
    docType: 'md',
    ageDays: 13,
    sections: [
      [
        'Identifying stalled work',
        'A job is stalled when it holds an active lock with no heartbeat past the lock duration. Compare queue active count against worker concurrency; a persistent gap means locks are not being renewed, usually because a worker was OOM-killed mid-job.',
      ],
      [
        'Recovery',
        'Promote stalled jobs back to waiting rather than deleting them — every processor in this system is idempotent on its entity id, so a replay is safe and a delete loses the work silently. Note the affected entity ids in the incident so their status fields can be verified afterwards.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: Redis failover',
    slug: 'runbook-redis-failover',
    docType: 'md',
    ageDays: 27,
    sections: [
      [
        'What breaks',
        'Redis holds job queues, rate-limit counters and the answer cache. During a failover, queued jobs pause, rate limiting fails open, and cached answers are lost. Nothing durable is lost: queue state is reconstructed from entity status columns.',
      ],
      [
        'After recovery',
        'Verify queue depth returns to normal and re-enqueue any entity left in processing with no active job. Cache misses after a failover are expected and self-heal; do not warm the cache manually.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: elevated API error rate',
    slug: 'runbook-api-errors',
    docType: 'md',
    ageDays: 6,
    sections: [
      [
        'Triage order',
        'Check the error budget dashboard, then split by endpoint. A spike concentrated on one endpoint is usually a deploy regression; a spread across all endpoints points at the database or Redis. Correlate with the deploy timeline before waking anyone else.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: rolling back a deploy',
    slug: 'runbook-rollback',
    docType: 'md',
    ageDays: 23,
    sections: [
      [
        'When to roll back',
        'Roll back immediately for any regression touching billing, invoicing, approvals or data deletion. For everything else, prefer a fix-forward if it can ship within thirty minutes.',
      ],
      [
        'How',
        'Redeploy the previous image tag. Migrations are additive by policy, so a rollback of application code is safe without a schema rollback. If a migration was destructive, it should never have shipped — escalate rather than improvising a down migration under pressure.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: certificate expiry',
    slug: 'runbook-cert-expiry',
    docType: 'md',
    ageDays: 34,
    sections: [
      [
        'Renewal',
        'Certificates renew automatically thirty days before expiry. An expiry alert means renewal failed, most often because the ACME challenge could not reach the host. Check DNS and the reverse proxy before touching the certificate itself.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: object storage full',
    slug: 'runbook-storage-full',
    docType: 'md',
    ageDays: 40,
    sections: [
      [
        'Immediate relief',
        'Expired export artifacts are the usual culprit, since download links live seven days but objects are only swept weekly. Run the sweep manually to reclaim space. Never delete document or dataset objects to free space — those are customer data with no second copy outside backups.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: restoring from backup',
    slug: 'runbook-restore-backup',
    docType: 'md',
    ageDays: 50,
    sections: [
      [
        'Scope of a restore',
        'Backups are cluster-wide point-in-time snapshots. Restoring rolls back every workspace in the cluster, so it is a disaster-recovery tool only and is never used to recover one tenant. Say that plainly to customers rather than implying a maybe.',
      ],
      [
        'Procedure',
        'Restore to a new cluster first and verify integrity before cutting traffic over. Announce a maintenance window, stop workers so no job writes during the switch, then repoint the application and re-enable workers once the health check is green.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: suspected data leak between workspaces',
    slug: 'runbook-tenant-leak',
    docType: 'md',
    ageDays: 19,
    sections: [
      [
        'Treat as Sev-1 immediately',
        'Any credible report of one workspace seeing another data is a Sev-1 regardless of scale. Capture the exact request, the two workspace ids, and the account that saw it before anything is changed — that evidence disappears once caches are cleared.',
      ],
      [
        'Containment',
        'Disable the suspect endpoint at the proxy rather than deploying a hasty fix. Then audit the query path for a missing workspace filter. Every tenant-scoped query must filter on workspace id at the database level; a check that lives only in the UI is not a control.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: email delivery failures',
    slug: 'runbook-email-failures',
    docType: 'md',
    ageDays: 29,
    sections: [
      [
        'Diagnosing',
        'Check the provider dashboard for bounces and complaints before assuming an application fault. A single domain rejecting us is usually a recipient-side block list; a broad spike is a sender-reputation problem and needs the deliverability contact, not a code change.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: onboarding a new on-call engineer',
    slug: 'runbook-oncall-onboarding',
    docType: 'md',
    ageDays: 45,
    sections: [
      [
        'Before the first shift',
        'Confirm paging works end to end with a test page, walk the dashboards, and shadow one full shift. Read the export backlog, QuickBooks sync and tenant-leak runbooks first — those three cover most of what actually pages.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: scheduled export storm',
    slug: 'runbook-export-storm',
    docType: 'md',
    ageDays: 8,
    sections: [
      [
        'The Monday 06:00 spike',
        'Scheduled exports all fire at 06:00 workspace time, so Monday morning in a busy region produces a burst. If depth exceeds 500 for more than ten minutes, scale workers and let it drain; the burst is self-limiting because each workspace has at most a handful of schedules.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: handling a GDPR erasure request',
    slug: 'runbook-gdpr-erasure',
    docType: 'md',
    ageDays: 56,
    sections: [
      [
        'What can and cannot be erased',
        'A member personal data (name, email, session records) can be anonymized on request. The hours they logged cannot be erased on demand, because they form part of the customer financial records; those are retained under the legitimate-interest basis and disclosed as such. Route every request through the DPO rather than acting directly.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: dependency vulnerability response',
    slug: 'runbook-vuln-response',
    docType: 'md',
    ageDays: 37,
    sections: [
      [
        'Triage',
        'Rate by reachability, not by CVSS alone — a critical in a transitive dependency we never call is lower priority than a medium on the request path. Patch reachable criticals within 48 hours, everything else on the normal release train, and record the decision either way.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Incident severity definitions',
    slug: 'severity-definitions',
    docType: 'pdf',
    ageDays: 64,
    sections: [
      [
        'Sev-1 to Sev-3',
        'Sev-1: data loss, cross-tenant exposure, billing or invoicing incorrect, or a full outage — page immediately, customer comms within 60 minutes. Sev-2: a major feature broken for many customers with a workaround — page during business hours. Sev-3: degraded but usable, handled on the normal board.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Postmortem template and norms',
    slug: 'postmortem-norms',
    docType: 'md',
    ageDays: 59,
    sections: [
      [
        'Blameless, but specific',
        'A postmortem names systems and decisions, never people. Required sections are impact, timeline, root cause, what made detection slow, and action items with owners and dates. An action item without an owner is a wish, not a commitment, and reviewers should reject the document for it.',
      ],
    ],
  },
  {
    kb: KB_RUNBOOKS_ID,
    title: 'Runbook: support escalation to engineering',
    slug: 'runbook-support-escalation',
    docType: 'md',
    ageDays: 22,
    sections: [
      [
        'What to include',
        'Escalate with the workspace id, the affected member email, the exact date range, a request id if the customer hit an error page, and what you already ruled out. That last part is what stops engineering repeating the same three checks support already did.',
      ],
    ],
  },
]
