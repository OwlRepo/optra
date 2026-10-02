import * as React from 'react'
import { cn } from '../../lib/utils'

type ConfidenceTier = 'verified' | 'flag' | 'risk'

// Storyboard 01 C16: thresholds unchanged (>= 0.75 / >= 0.4), mapped onto
// teal / amber / red. The emerald success and yellow warning fills are gone.
const tierFillClass: Record<ConfidenceTier, string> = {
  verified: 'bg-primary-strong',
  flag: 'bg-flag',
  risk: 'bg-destructive-tone',
}

function tierFor(value: number): ConfidenceTier {
  if (value >= 0.75) return 'verified'
  if (value >= 0.4) return 'flag'
  return 'risk'
}

export interface ConfidenceMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..1 confidence score. Out-of-range values are clamped, never thrown on. */
  value: number
  /** Overrides the default rounded-percentage label (e.g. "82%"). */
  label?: string
  /** md = the C16 row (84px "Confidence" label, 40px figure); sm = the compact C18 footer ("Conf."). */
  size?: 'sm' | 'md'
}

export function ConfidenceMeter({ value, label, size = 'md', className, ...props }: ConfidenceMeterProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const percent = Math.round(clamped * 100)
  const tier = tierFor(clamped)
  const displayLabel = label ?? `${percent}%`
  const compact = size === 'sm'

  return (
    <div className={cn('flex items-center', compact ? 'gap-[10px]' : 'gap-3', className)} {...props}>
      <span
        aria-hidden="true"
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted',
          compact ? null : 'w-[84px] shrink-0',
        )}
      >
        {compact ? 'Conf.' : 'Confidence'}
      </span>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `Confidence ${percent}%`}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-border-definition"
      >
        <div
          data-fill
          className={cn('h-full rounded-[3px] transition-[width] duration-300', tierFillClass[tier])}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn('font-mono text-[12px] text-foreground', compact ? null : 'w-10 shrink-0 text-right')}>
        {displayLabel}
      </span>
    </div>
  )
}
