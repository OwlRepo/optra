// Structured datasets for the Datasets page and the text-to-SQL chat path.
//
// Unlike documents, datasets are NOT chunked or embedded — only the description
// is embedded (for semantic dataset selection); the rows themselves are queried
// with ephemeral DuckDB at question time, straight off the CSV in object
// storage. So a dataset row with a null storageKey is a dead end: the seeder
// must upload real CSV bytes, which is what buildDatasetFiles() produces.
//
// Row values are generated deterministically (no Math.random) so the same seed
// run always yields the same numbers — a demo answer stays reproducible.
import type { DatasetColumn } from '@repo/db'
import { DEMO_WORKSPACE_ID, daysAgo } from '../config'

export interface SeedDataset {
  id: string
  name: string
  description: string
  columns: DatasetColumn[]
  rows: (string | number)[][]
  ageDays: number
}

function datasetId(n: number): string {
  return `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** Deterministic pseudo-random in [0,1) — Math.random would break reproducibility. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.floor(rand(seed) * list.length) % list.length]!
}

function isoDay(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

const CLIENTS = ['Acme Consulting', 'Brightwave', 'Cobalt Studio', 'Delta Mills', 'Everline', 'Foundry 9']
const MEMBERS = [
  'priya@heliolabs.io',
  'marcus@heliolabs.io',
  'sofia@heliolabs.io',
  'jon@heliolabs.io',
  'amara@heliolabs.io',
  'lukas@heliolabs.io',
]
const PRODUCT_AREAS = ['exports', 'reporting', 'billing', 'integrations', 'auth-sso', 'timers', 'mobile', 'imports']
const CHANNELS = ['email', 'in-app chat', 'phone']
const PLANS = ['Starter', 'Team', 'Business']

function supportTickets(): SeedDataset {
  const rows: (string | number)[][] = []
  for (let i = 0; i < 480; i += 1) {
    const day = 180 - Math.floor(i / 3)
    const area = pick(PRODUCT_AREAS, i + 1)
    const severity = rand(i + 7) > 0.82 ? 'high' : rand(i + 13) > 0.45 ? 'medium' : 'low'
    const firstResponse = Math.round(20 + rand(i + 3) * 400)
    const resolution = firstResponse + Math.round(60 + rand(i + 11) * 3600)
    rows.push([
      `T-${4000 + i}`,
      isoDay(day),
      area,
      severity,
      pick(CHANNELS, i + 5),
      pick(CLIENTS, i + 9),
      pick(PLANS, i + 17),
      firstResponse,
      resolution,
      rand(i + 23) > 0.18 ? 'resolved' : 'open',
      Math.round((3 + rand(i + 29) * 2) * 10) / 10,
    ])
  }
  return {
    id: datasetId(1),
    name: 'support_tickets_180d.csv',
    description:
      'Every Helio Labs support ticket from the last 180 days: product area, severity, channel, client, plan, first-response and resolution time in minutes, final status, and the CSAT score the customer left. Use it for questions about ticket volume, response-time SLAs, which product areas generate the most work, and satisfaction by plan or client.',
    columns: [
      { name: 'ticket_id', type: 'string' },
      { name: 'created_date', type: 'date' },
      { name: 'product_area', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'channel', type: 'string' },
      { name: 'client', type: 'string' },
      { name: 'plan', type: 'string' },
      { name: 'first_response_minutes', type: 'number' },
      { name: 'resolution_minutes', type: 'number' },
      { name: 'status', type: 'string' },
      { name: 'csat', type: 'number' },
    ],
    rows,
    ageDays: 21,
  }
}

function timeEntries(): SeedDataset {
  const rows: (string | number)[][] = []
  for (let i = 0; i < 900; i += 1) {
    // Spread across a full year, not one quarter: "last quarter", "this
    // month" and "year to date" all have to land on rows, whichever way the
    // SQL generator chooses to interpret them.
    const day = 364 - Math.floor((i * 364) / 900)
    const hours = Math.round((0.5 + rand(i + 2) * 7.5) * 100) / 100
    const billable = rand(i + 19) > 0.28
    const rate = billable ? [95, 120, 145, 165][Math.floor(rand(i + 31) * 4)]! : 0
    rows.push([
      `E-${9000 + i}`,
      isoDay(day),
      pick(MEMBERS, i + 4),
      pick(CLIENTS, i + 6),
      pick(['Discovery', 'Implementation', 'Support retainer', 'Migration', 'Training'], i + 8),
      hours,
      billable ? 'true' : 'false',
      rate,
      Math.round(hours * rate * 100) / 100,
      pick(['approved', 'approved', 'approved', 'pending', 'rejected'], i + 12),
    ])
  }
  return {
    id: datasetId(2),
    name: 'time_entries_12mo.csv',
    description:
      'Individual time entries logged by Helio Labs staff over the last twelve months: work date, member email, client, project, hours, whether the entry is billable, the hourly rate applied, the resulting revenue, and its approval state. Use it for utilization, billable ratio, revenue by client or member, month-over-month or quarter-over-quarter trends, and approval-backlog questions.',
    columns: [
      { name: 'entry_id', type: 'string' },
      { name: 'work_date', type: 'date' },
      { name: 'member_email', type: 'string' },
      { name: 'client', type: 'string' },
      { name: 'project', type: 'string' },
      { name: 'hours', type: 'number' },
      { name: 'billable', type: 'boolean' },
      { name: 'hourly_rate', type: 'number' },
      { name: 'revenue', type: 'number' },
      { name: 'approval_status', type: 'string' },
    ],
    rows,
    ageDays: 17,
  }
}

function exportJobs(): SeedDataset {
  const rows: (string | number)[][] = []
  for (let i = 0; i < 340; i += 1) {
    const day = 120 - Math.floor(i / 3)
    const rowCount = Math.round(200 + rand(i + 5) * 60_000)
    const failed = rowCount > 50_000 && rand(i + 15) > 0.35
    rows.push([
      `X-${2000 + i}`,
      isoDay(day),
      pick(['csv', 'xlsx', 'pdf'], i + 3),
      pick(CLIENTS, i + 7),
      rowCount,
      Math.round(400 + rand(i + 9) * 90_000),
      failed ? 'failed' : 'completed',
      failed ? 'row cap exceeded' : '',
      rand(i + 21) > 0.75 ? 'scheduled' : 'manual',
    ])
  }
  return {
    id: datasetId(3),
    name: 'export_jobs_120d.csv',
    description:
      'Every timesheet export job run in the last 120 days: format, requesting client, row count, duration in milliseconds, whether it completed or failed, the failure reason, and whether it was scheduled or manual. Use it to investigate export failures, the 50,000-row cap, slow exports, and scheduled-export reliability.',
    columns: [
      { name: 'job_id', type: 'string' },
      { name: 'run_date', type: 'date' },
      { name: 'format', type: 'string' },
      { name: 'client', type: 'string' },
      { name: 'row_count', type: 'number' },
      { name: 'duration_ms', type: 'number' },
      { name: 'status', type: 'string' },
      { name: 'failure_reason', type: 'string' },
      { name: 'trigger', type: 'string' },
    ],
    rows,
    ageDays: 12,
  }
}

function seatUsage(): SeedDataset {
  const rows: (string | number)[][] = []
  for (let i = 0; i < 216; i += 1) {
    const client = CLIENTS[i % CLIENTS.length]!
    const month = 11 - Math.floor(i / CLIENTS.length / 3)
    const purchased = 10 + Math.floor(rand(i + 2) * 90)
    const active = Math.max(1, Math.round(purchased * (0.45 + rand(i + 6) * 0.55)))
    rows.push([
      client,
      `2026-${String(Math.max(1, month)).padStart(2, '0')}`,
      pick(PLANS, i + 3),
      purchased,
      active,
      Math.round((active / purchased) * 1000) / 10,
      Math.round(purchased * (rand(i + 8) > 0.6 ? 18 : 12) * 100) / 100,
    ])
  }
  return {
    id: datasetId(4),
    name: 'seat_usage_by_client.csv',
    description:
      'Monthly seat utilization per client: plan, seats purchased, seats actually active, utilization percentage, and monthly recurring revenue. Use it for expansion and churn-risk questions — which clients are paying for seats nobody uses, and which are close to outgrowing their plan.',
    columns: [
      { name: 'client', type: 'string' },
      { name: 'month', type: 'string' },
      { name: 'plan', type: 'string' },
      { name: 'seats_purchased', type: 'number' },
      { name: 'seats_active', type: 'number' },
      { name: 'utilization_pct', type: 'number' },
      { name: 'mrr', type: 'number' },
    ],
    rows,
    ageDays: 34,
  }
}

function invoiceAging(): SeedDataset {
  const rows: (string | number)[][] = []
  for (let i = 0; i < 180; i += 1) {
    const issued = 150 - Math.floor(i * 0.8)
    const terms = [14, 30, 45][Math.floor(rand(i + 4) * 3)]!
    const daysLate = rand(i + 14) > 0.62 ? Math.round(rand(i + 16) * 70) : 0
    const amount = Math.round((800 + rand(i + 18) * 24_000) * 100) / 100
    rows.push([
      `INV-${45000 + i}`,
      isoDay(issued),
      pick(CLIENTS, i + 2),
      amount,
      terms,
      isoDay(Math.max(0, issued - terms)),
      daysLate === 0 ? 'paid' : daysLate > 45 ? 'overdue' : 'late',
      daysLate,
      pick(['bank transfer', 'card', 'direct debit'], i + 11),
    ])
  }
  return {
    id: datasetId(5),
    name: 'invoice_aging.csv',
    description:
      'Issued invoices with payment terms, due dates, amounts, how many days late payment was, the current settlement state, and payment method. Use it for cash-collection questions: total overdue, worst-paying clients, average days-to-pay by payment method or terms.',
    columns: [
      { name: 'invoice_number', type: 'string' },
      { name: 'issued_date', type: 'date' },
      { name: 'client', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'terms_days', type: 'number' },
      { name: 'due_date', type: 'date' },
      { name: 'status', type: 'string' },
      { name: 'days_late', type: 'number' },
      { name: 'payment_method', type: 'string' },
    ],
    rows,
    ageDays: 45,
  }
}

function npsResponses(): SeedDataset {
  const themes = [
    'exports are slow for big ranges',
    'approvals workflow is clear',
    'wish there was a Slack integration',
    'mobile app is limited',
    'reporting is flexible',
    'QuickBooks sync broke once',
    'onboarding was easy',
    'needs bulk editing',
  ]
  const rows: (string | number)[][] = []
  for (let i = 0; i < 260; i += 1) {
    const score = Math.min(10, Math.max(0, Math.round(4 + rand(i + 3) * 7)))
    rows.push([
      `R-${700 + i}`,
      isoDay(160 - Math.floor(i / 2)),
      pick(CLIENTS, i + 5),
      pick(PLANS, i + 7),
      score,
      score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor',
      pick(themes, i + 13),
      pick(['owner', 'manager', 'member'], i + 19),
    ])
  }
  return {
    id: datasetId(6),
    name: 'nps_responses.csv',
    description:
      'Raw NPS survey responses: score, promoter/passive/detractor bucket, the free-text theme the respondent mentioned, their role, plan and client. Use it for sentiment questions — what detractors complain about most, NPS by plan, and which themes correlate with low scores.',
    columns: [
      { name: 'response_id', type: 'string' },
      { name: 'response_date', type: 'date' },
      { name: 'client', type: 'string' },
      { name: 'plan', type: 'string' },
      { name: 'score', type: 'number' },
      { name: 'bucket', type: 'string' },
      { name: 'theme', type: 'string' },
      { name: 'role', type: 'string' },
    ],
    rows,
    ageDays: 58,
  }
}

export const seedDatasets: SeedDataset[] = [
  supportTickets(),
  timeEntries(),
  exportJobs(),
  seatUsage(),
  invoiceAging(),
  npsResponses(),
]

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function datasetCsv(dataset: SeedDataset): string {
  const header = dataset.columns.map(c => c.name).join(',')
  const body = dataset.rows.map(row => row.map(csvCell).join(',')).join('\n')
  return `${header}\n${body}\n`
}

/** Storage key mirrors DatasetsService.upload: <workspaceId>/datasets/<uuid>-<name>. */
export function datasetStorageKey(dataset: SeedDataset): string {
  return `${DEMO_WORKSPACE_ID}/datasets/${dataset.id}-${dataset.name}`
}

export function buildDatasetFiles(): { key: string; csv: string }[] {
  return seedDatasets.map(dataset => ({ key: datasetStorageKey(dataset), csv: datasetCsv(dataset) }))
}

export function buildDatasetRows(embeddings: Map<string, number[] | null>) {
  return seedDatasets.map(dataset => ({
    id: dataset.id,
    workspaceId: DEMO_WORKSPACE_ID,
    name: dataset.name,
    storageKey: datasetStorageKey(dataset),
    description: dataset.description,
    descriptionEmbedding: embeddings.get(dataset.id) ?? null,
    columnsSchema: dataset.columns,
    rowCount: dataset.rows.length,
    contentHash: null,
    status: 'done' as const,
    queueJobId: null,
    enqueuedAt: daysAgo(dataset.ageDays),
    processingStartedAt: daysAgo(dataset.ageDays),
    lastError: null,
    createdAt: daysAgo(dataset.ageDays),
    updatedAt: daysAgo(Math.max(0, dataset.ageDays - 1)),
  }))
}
