import * as React from 'react'
import { cn } from '../../lib/utils'

type ConfidenceTier = 'success' | 'warning' | 'destructive'

const tierFillClass: Record<ConfidenceTier, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

function tierFor(value: number): ConfidenceTier {
  if (value >= 0.75) return 'success'
  if (value >= 0.4) return 'warning'
  return 'destructive'
}

export interface ConfidenceMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..1 confidence score. Out-of-range values are clamped, never thrown on. */
  value: number
  /** Overrides the default rounded-percentage label (e.g. "82%"). */
  label?: string
  size?: 'sm' | 'md'
}

export function ConfidenceMeter({ value, label, size = 'md', className, ...props }: ConfidenceMeterProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const percent = Math.round(clamped * 100)
  const tier = tierFor(clamped)
  const displayLabel = label ?? `${percent}%`

  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `Confidence ${percent}%`}
        className={cn('w-full overflow-hidden rounded-full bg-secondary', size === 'sm' ? 'h-1.5' : 'h-2')}
      >
        <div
          data-fill
          className={cn('h-full rounded-full transition-[width] duration-300', tierFillClass[tier])}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{displayLabel}</span>
    </div>
  )
}
