import type { DigestContent } from './digest-content.service'

const EVENT_LABELS: Record<string, string> = {
  document_ingested: 'documents ingested',
  document_failed: 'document ingests failed',
  scrape_completed: 'crawls completed',
  scrape_failed: 'crawls failed',
  ticket_extracted: 'tickets extracted',
  ticket_failed: 'ticket extractions failed',
}

// A digest with nothing notable is a normal, expected outcome (most weeks,
// most workspaces) — not an error state. Both renderers handle it as a
// first-class case rather than an edge case bolted on.
function isQuietWeek(content: DigestContent): boolean {
  const hasEvents = Object.values(content.eventCounts).some((value) => value > 0)
  return (
    !hasEvents &&
    content.chatSummary.totalQueries === 0 &&
    content.newFreshnessFlags === 0 &&
    content.newFaqDrafts === 0 &&
    content.newTickets === 0
  )
}

function buildLines(content: DigestContent): string[] {
  const lines: string[] = []

  for (const [type, value] of Object.entries(content.eventCounts)) {
    if (value > 0) lines.push(`${value} ${EVENT_LABELS[type] ?? type}`)
  }
  if (content.newTickets > 0) lines.push(`${content.newTickets} new tickets`)
  if (content.chatSummary.totalQueries > 0) {
    lines.push(`${content.chatSummary.totalQueries} chat questions asked`)
    lines.push(`${Math.round(content.chatSummary.fallbackRate * 100)}% had no good answer`)
  }
  if (content.newFreshnessFlags > 0) lines.push(`${content.newFreshnessFlags} documents flagged as possibly stale`)
  if (content.newFaqDrafts > 0) lines.push(`${content.newFaqDrafts} FAQ drafts waiting for review`)

  return lines
}

export function renderDigestEmailHtml(content: DigestContent): string {
  if (isQuietWeek(content)) {
    return `<h2>Mnemra weekly digest</h2><p>Quiet week — no notable activity in the last ${content.windowDays} days.</p>`
  }

  const items = buildLines(content)
    .map((line) => `<li>${line}</li>`)
    .join('')

  return `<h2>Mnemra weekly digest</h2><p>Here's what happened in the last ${content.windowDays} days:</p><ul>${items}</ul>`
}

export interface SlackPayload {
  text: string
}

export function renderDigestSlackPayload(content: DigestContent): SlackPayload {
  if (isQuietWeek(content)) {
    return { text: `*Mnemra weekly digest*\nQuiet week — no notable activity in the last ${content.windowDays} days.` }
  }

  const items = buildLines(content)
    .map((line) => `• ${line}`)
    .join('\n')

  return { text: `*Mnemra weekly digest*\nLast ${content.windowDays} days:\n${items}` }
}
