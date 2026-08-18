// Retrieval-quality telemetry behind Insights → Coverage.
//
// CoverageDashboardService computes its summary live from chat_query_metrics
// over a 30-day window (totalQueries, fallbackRate, cacheHitRate, avgTopScore)
// and lists any row that is a fallback or scores below 0.4. So the numbers on
// that page are only as interesting as these rows: the spread below produces a
// believable fallback rate and cache-hit rate rather than a flat 0.
//
// questionEmbedding is left null throughout — the column is nullable, the
// dashboard never reads it, and only the weekly topic-gap job would use it.
// Panel 3 (topic gaps) is served from Redis instead; see TOPIC_GAPS below.
import { DEMO_WORKSPACE_ID, hoursAgo } from '../config'
import type { SeedChatMessage } from './chat'

interface MetricSpec {
  question: string
  topScore: number | null
  cacheStatus: 'exact' | 'semantic' | 'miss'
  queryClass: string
  isFallback?: boolean
  hoursAgo: number
  latencyMs: number
  sourceCount: number
}

// Real-looking support questions. The low-scoring and fallback ones are the
// point: they populate the "questions we answered badly" list, which is the
// panel that makes the Insights page worth showing.
const SPECS: MetricSpec[] = [
  { question: 'How do I export a timesheet to CSV?', topScore: 0.91, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 6, latencyMs: 2140, sourceCount: 4 },
  { question: 'export timesheet csv', topScore: 0.89, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 8, latencyMs: 310, sourceCount: 4 },
  { question: 'How do I export a timesheet to CSV?', topScore: 0.91, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 12, latencyMs: 96, sourceCount: 4 },
  { question: 'Why did QuickBooks sync fail?', topScore: 0.93, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 20, latencyMs: 2650, sourceCount: 5 },
  { question: 'quickbooks integration degraded', topScore: 0.87, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 26, latencyMs: 288, sourceCount: 5 },
  { question: 'Can a manager approve their own timesheet?', topScore: 0.94, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 30, latencyMs: 1980, sourceCount: 3 },
  { question: 'How do I reopen an approved week?', topScore: 0.9, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 34, latencyMs: 2210, sourceCount: 3 },
  { question: 'What is the export row limit?', topScore: 0.88, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 38, latencyMs: 88, sourceCount: 2 },
  { question: 'Why are hours missing from my report?', topScore: 0.94, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 44, latencyMs: 2480, sourceCount: 6 },
  { question: 'time zone report wrong day', topScore: 0.8, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 50, latencyMs: 340, sourceCount: 4 },
  { question: 'How does SSO enforcement work?', topScore: 0.92, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 56, latencyMs: 2050, sourceCount: 3 },
  { question: 'okta group role mapping', topScore: 0.36, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 60, latencyMs: 2890, sourceCount: 1 },
  { question: 'Do you support SCIM provisioning?', topScore: 0.21, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 64, latencyMs: 3120, sourceCount: 0 },
  { question: 'Is there a Slack integration?', topScore: 0.18, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 70, latencyMs: 3040, sourceCount: 0 },
  { question: 'slack notifications for approvals', topScore: 0.24, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 76, latencyMs: 2960, sourceCount: 0 },
  { question: 'How do I bulk edit time entries?', topScore: 0.33, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 82, latencyMs: 2770, sourceCount: 2 },
  { question: 'bulk edit entries across a week', topScore: 0.29, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 88, latencyMs: 3210, sourceCount: 1 },
  { question: 'What are the rounding options?', topScore: 0.9, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 94, latencyMs: 1870, sourceCount: 3 },
  { question: 'rounding nearest 15 invoice totals', topScore: 0.85, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 100, latencyMs: 305, sourceCount: 3 },
  { question: 'How long are download links valid?', topScore: 0.86, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 108, latencyMs: 91, sourceCount: 2 },
  { question: 'Compare utilization across our three teams last quarter', topScore: 0.61, cacheStatus: 'miss', queryClass: 'complex', hoursAgo: 116, latencyMs: 5240, sourceCount: 5 },
  { question: 'Summarize every ticket about exports this month', topScore: 0.72, cacheStatus: 'miss', queryClass: 'complex', hoursAgo: 124, latencyMs: 6110, sourceCount: 8 },
  { question: 'What changed in our approvals policy?', topScore: 0.68, cacheStatus: 'miss', queryClass: 'complex', hoursAgo: 132, latencyMs: 4890, sourceCount: 4 },
  { question: 'webhook signature verification', topScore: 0.89, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 140, latencyMs: 2010, sourceCount: 3 },
  { question: 'How do I rotate an API key?', topScore: 0.84, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 150, latencyMs: 297, sourceCount: 3 },
  { question: 'Can I restore a deleted workspace?', topScore: 0.89, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 160, latencyMs: 2330, sourceCount: 4 },
  { question: 'workspace purge 30 days', topScore: 0.87, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 168, latencyMs: 84, sourceCount: 4 },
  { question: 'Does the mobile app work offline?', topScore: 0.79, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 180, latencyMs: 2120, sourceCount: 2 },
  { question: 'offline sync duplicate entries', topScore: 0.83, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 192, latencyMs: 312, sourceCount: 3 },
  { question: 'What is our SLA for first response?', topScore: 0.81, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 204, latencyMs: 1950, sourceCount: 2 },
  { question: 'Do you have a Jira integration?', topScore: 0.15, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 216, latencyMs: 3080, sourceCount: 0 },
  { question: 'jira sync tickets automatically', topScore: 0.19, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 228, latencyMs: 3190, sourceCount: 0 },
  { question: 'How do tags work?', topScore: 0.88, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 240, latencyMs: 1890, sourceCount: 2 },
  { question: 'rename a tag everywhere', topScore: 0.82, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 252, latencyMs: 301, sourceCount: 3 },
  { question: 'What roles exist?', topScore: 0.92, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 264, latencyMs: 79, sourceCount: 2 },
  { question: 'restricted project visibility', topScore: 0.86, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 276, latencyMs: 2240, sourceCount: 4 },
  { question: 'How do I invite someone?', topScore: 0.9, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 288, latencyMs: 86, sourceCount: 2 },
  { question: 'seat billing when invite accepted', topScore: 0.78, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 300, latencyMs: 318, sourceCount: 2 },
  { question: 'Can we get a custom report builder?', topScore: 0.27, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 320, latencyMs: 2810, sourceCount: 1 },
  { question: 'export directly to Google Sheets', topScore: 0.22, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 340, latencyMs: 3260, sourceCount: 0 },
  { question: 'google sheets sync hours', topScore: 0.2, cacheStatus: 'miss', queryClass: 'simple', isFallback: true, hoursAgo: 360, latencyMs: 3150, sourceCount: 0 },
  { question: 'What happens when a plan is downgraded?', topScore: 0.85, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 380, latencyMs: 2190, sourceCount: 3 },
  { question: 'timer running over the weekend', topScore: 0.87, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 400, latencyMs: 2080, sourceCount: 3 },
  { question: 'clock skew after deploy', topScore: 0.84, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 430, latencyMs: 292, sourceCount: 2 },
  { question: 'import csv columns required', topScore: 0.83, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 460, latencyMs: 2270, sourceCount: 2 },
  { question: 'dry run validation for imports', topScore: 0.31, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 490, latencyMs: 2930, sourceCount: 1 },
  { question: 'Show me export failures by week', topScore: 0.64, cacheStatus: 'miss', queryClass: 'complex', hoursAgo: 520, latencyMs: 5580, sourceCount: 6 },
  { question: 'billable vs non billable defaults', topScore: 0.86, cacheStatus: 'exact', queryClass: 'simple', hoursAgo: 560, latencyMs: 82, sourceCount: 2 },
  { question: 'weekly reminder settings', topScore: 0.85, cacheStatus: 'semantic', queryClass: 'simple', hoursAgo: 600, latencyMs: 299, sourceCount: 2 },
  { question: 'on-call escalation policy', topScore: 0.88, cacheStatus: 'miss', queryClass: 'simple', hoursAgo: 640, latencyMs: 2160, sourceCount: 2 },
]

/**
 * chat_query_metrics rows. Every row needs a real sessionId + chatMessageId
 * (both NOT NULL with FKs), so the specs are attached round-robin to the
 * seeded assistant messages.
 */
export function buildQueryMetricRows(assistantMessages: SeedChatMessage[]) {
  if (assistantMessages.length === 0) {
    throw new Error('buildQueryMetricRows needs at least one assistant message to anchor FKs')
  }
  return SPECS.map((spec, i) => {
    const anchor = assistantMessages[i % assistantMessages.length]!
    return {
      workspaceId: DEMO_WORKSPACE_ID,
      sessionId: anchor.sessionId,
      chatMessageId: anchor.id,
      question: spec.question,
      questionEmbedding: null,
      topScore: spec.topScore,
      sourceCount: spec.sourceCount,
      isFallback: spec.isFallback ?? false,
      cacheStatus: spec.cacheStatus,
      queryClass: spec.queryClass,
      latencyMs: spec.latencyMs,
      createdAt: hoursAgo(spec.hoursAgo),
    }
  })
}

/**
 * Panel 3 of the coverage dashboard reads this from Redis, not Postgres — it
 * is normally written by the weekly topic-gap job. Key and shape come from
 * apps/api/src/insights/coverage-dashboard.service.ts.
 */
export const TOPIC_GAPS = [
  { label: 'Slack integration', questionCount: 9, exampleQuestion: 'Is there a Slack integration?' },
  { label: 'SCIM / directory sync', questionCount: 6, exampleQuestion: 'Do you support SCIM provisioning?' },
  { label: 'Bulk editing time entries', questionCount: 5, exampleQuestion: 'How do I bulk edit time entries?' },
  { label: 'Google Sheets export', questionCount: 4, exampleQuestion: 'Can I export directly to Google Sheets?' },
]
