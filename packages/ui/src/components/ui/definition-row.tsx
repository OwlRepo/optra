import * as React from 'react'
import { cn } from '../../lib/utils'

export interface DefinitionRowProps {
  label: React.ReactNode
  value: React.ReactNode
  action?: React.ReactNode
  className?: string
}

// Storyboard 01 C20 "Files & trust" row: 110px Mono teal label on the subtle
// fill | Mono 12 value | optional action. Stack rows inside a panel with
// overflow-hidden; the last row drops its rule.
export function DefinitionRow({ label, value, action, className }: DefinitionRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[110px_minmax(0,1fr)_auto] items-center border-b border-border-definition last:border-b-0',
        className,
      )}
    >
      <div className="self-stretch bg-surface-subtle px-[18px] py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-primary-strong">
        {label}
      </div>
      <div className="min-w-0 break-words px-[18px] py-4 font-mono text-[12px] text-[oklch(0.36_0.02_264)]">{value}</div>
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
