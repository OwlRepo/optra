import * as React from 'react'
import { cn } from '../../lib/utils'

export interface DefinitionRowProps {
  label: React.ReactNode
  value: React.ReactNode
  action?: React.ReactNode
  /**
   * default = C20 sheet (110px, 16px 18px); compact = frame 2.9 citations
   * (96px, 13px 16px); roomy = frame 3.10 Workspace ID (140px, label 14px 24px,
   * value 14px 18px). The screen frame wins where a row is actually used.
   */
  density?: 'default' | 'compact' | 'roomy'
  className?: string
}

const densityClassName = {
  default: { grid: 'grid-cols-[110px_minmax(0,1fr)_auto]', label: 'px-[18px] py-4', value: 'px-[18px] py-4' },
  compact: { grid: 'grid-cols-[96px_minmax(0,1fr)_auto]', label: 'px-4 py-[13px]', value: 'px-4 py-[13px]' },
  roomy: { grid: 'grid-cols-[140px_minmax(0,1fr)_auto]', label: 'px-6 py-[14px]', value: 'px-[18px] py-[14px]' },
}

// Storyboard 01 C20 "Files & trust" row: 110px Mono teal label on the subtle
// fill | Mono 12 value | optional action. Stack rows inside a panel with
// overflow-hidden; the last row drops its rule.
export function DefinitionRow({ label, value, action, density = 'default', className }: DefinitionRowProps) {
  const sizing = densityClassName[density]
  return (
    <div
      className={cn(
        'grid items-center border-b border-border-definition last:border-b-0',
        sizing.grid,
        className,
      )}
    >
      <div
        className={cn(
          'self-stretch bg-surface-subtle font-mono text-[10px] uppercase tracking-[0.14em] text-primary-strong',
          sizing.label,
        )}
      >
        {label}
      </div>
      <div className={cn('min-w-0 break-words font-mono text-[12px] text-[oklch(0.36_0.02_264)]', sizing.value)}>{value}</div>
      {action ? <div className="mr-[10px]">{action}</div> : <div />}
    </div>
  )
}

export type MetricTileTone = 'amber' | 'red'

export interface MetricTileProps {
  label: string
  value: React.ReactNode
  /** The figure that breaks the match: amber (act on it) or red (money at risk). */
  tone?: MetricTileTone
  /** Alias for tone="amber" (kept for existing callers). */
  breaking?: boolean
  className?: string
}

const metricToneClassName: Record<MetricTileTone, { tile: string; ink: string }> = {
  amber: { tile: 'border-flag/40 bg-flag/6', ink: 'text-flag-strong' },
  red: { tile: 'border-destructive-tone/35 bg-destructive-tone/6', ink: 'text-destructive-strong-text' },
}

// Storyboard 01 C20 demo tile (Ordered / Received / Billed).
export function MetricTile({ label, value, tone, breaking = false, className }: MetricTileProps) {
  const effectiveTone: MetricTileTone | undefined = tone ?? (breaking ? 'amber' : undefined)
  const toneUi = effectiveTone ? metricToneClassName[effectiveTone] : null
  return (
    <div
      data-breaking={effectiveTone ? 'true' : undefined}
      data-tone={effectiveTone}
      className={cn('rounded-[12px] border p-3', toneUi ? toneUi.tile : 'border-border-segmented bg-card', className)}
    >
      <p className={cn('text-[11px] uppercase tracking-[0.1em]', toneUi ? toneUi.ink : 'text-[oklch(0.58_0.02_264)]')}>
        {label}
      </p>
      <p className={cn('mt-[7px] font-mono text-[17px]', toneUi ? toneUi.ink : 'text-foreground')}>{value}</p>
    </div>
  )
}
