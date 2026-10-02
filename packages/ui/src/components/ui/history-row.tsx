import * as React from 'react'
import { cn } from '../../lib/utils'

export type HistoryRowTone = 'teal' | 'amber' | 'red' | 'neutral'

// Tone by event type (C19): *_failed red, comparison_flagged amber,
// document_ingested / scrape_completed teal, ticket_extracted neutral. The
// mapping from event type to tone belongs to the caller.
const toneClassName: Record<HistoryRowTone, { rule: string; key: string }> = {
  teal: { rule: 'border-l-primary-strong', key: 'text-primary-strong-hover' },
  amber: { rule: 'border-l-flag', key: 'text-flag-strong' },
  red: { rule: 'border-l-destructive-tone', key: 'text-destructive-strong-text' },
  neutral: { rule: 'border-l-border-dashed', key: 'text-ink-muted' },
}

export interface HistoryRowProps {
  /** Mono event key, e.g. "comparison_flagged". */
  eventKey: string
  title: React.ReactNode
  detail?: React.ReactNode
  timestamp: React.ReactNode
  tone: HistoryRowTone
  /** Not yet seen (before markEventsSeen): teal tint, rounded right edge. */
  unseen?: boolean
  className?: string
}

// Frame 3.3 Overview activity (C19 pattern; screen frame wins): 170px key |
// 1fr title (14/500) + detail | auto timestamp, 2px tone rule. Unseen rows get
// the teal /0.06 tint whatever their tone.
export function HistoryRow({ eventKey, title, detail, timestamp, tone, unseen = false, className }: HistoryRowProps) {
  const toneUi = toneClassName[tone]
  return (
    <div
      data-tone={tone}
      data-unseen={unseen ? 'true' : undefined}
      className={cn(
        'grid grid-cols-[170px_minmax(0,1fr)_auto] items-baseline gap-4 border-l-2 px-[14px] py-[10px]',
        toneUi.rule,
        unseen ? 'rounded-r-[10px] bg-primary-strong/6' : null,
        className,
      )}
    >
      <span className={cn('min-w-0 break-words font-mono text-[11px]', toneUi.key)}>{eventKey}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        {detail ? <span className="mt-[2px] block text-[13px] text-[oklch(0.48_0.02_264)]">{detail}</span> : null}
      </span>
      <span className="whitespace-nowrap font-mono text-[11px] text-ink-muted">{timestamp}</span>
    </div>
  )
}
