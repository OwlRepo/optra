import * as React from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Card } from './card'

type Trend = 'up' | 'down' | 'neutral'

const trendStyles: Record<Trend, { icon: React.ReactNode; className: string }> = {
  up: {
    icon: <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />,
    className: 'text-primary-strong-hover',
  },
  down: {
    icon: <ArrowDownRight className="size-3.5 shrink-0" aria-hidden="true" />,
    className: 'text-destructive-strong-text',
  },
  neutral: {
    icon: <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />,
    className: 'text-ink-muted',
  },
}

// Storyboard 01 C10: the icon-in-a-teal-tile is removed. `icon` stays in the
// props so existing call sites compile; it is not rendered.
export function StatCard({
  label,
  value,
  hint,
  trend = 'neutral',
  icon: _icon,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  trend?: Trend
  icon?: React.ReactNode
  className?: string
}) {
  const trendUi = trendStyles[trend]

  return (
    <Card variant="panel" className={cn('px-6 py-[22px]', className)}>
      <p className="text-[13px] text-ink-muted">{label}</p>
      <div
        className="mt-2 font-display text-[30px] font-semibold tracking-[-0.03em] tabular-nums text-foreground"
        data-numeric
      >
        {value}
      </div>
      {hint ? (
        <p className={cn('mt-2 flex items-center gap-[6px] text-[13px]', trendUi.className)}>
          {trendUi.icon}
          <span>{hint}</span>
        </p>
      ) : null}
    </Card>
  )
}

export interface StatStripItem {
  label: string
  value: number
  /** Finding tone; applied to the value only when value > 0. */
  tone?: 'red' | 'amber'
  hint?: string
  trend?: Trend
}

const stripToneClassName: Record<'red' | 'amber', string> = {
  red: 'text-destructive-strong-text',
  amber: 'text-flag-text',
}

// Desktop: one row, N equal cells (static classes so Tailwind sees them).
const stripColumnsClassName: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
}

// C10 / frames 2.7 (desktop, one row) and 4.2 (mobile, 2-up): one bordered
// strip split by inner hairlines.
export function StatStrip({ items, className }: { items: StatStripItem[]; className?: string }) {
  const count = items.length
  const columns = Math.min(Math.max(count, 1), 6)
  const lastMobileRowStart = count % 2 === 0 ? count - 2 : count - 1

  return (
    <div
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-[16px] border border-border-panel bg-card lg:rounded-[18px]',
        stripColumnsClassName[columns],
        className,
      )}
    >
      {items.map((item, index) => {
        const toneClassName = item.tone && item.value > 0 ? stripToneClassName[item.tone] : 'text-foreground'
        const trendUi = trendStyles[item.trend ?? 'neutral']
        const mobileRightRule = index % 2 === 0 && index < count - 1
        const mobileBottomRule = index < lastMobileRowStart
        return (
          <div
            key={item.label}
            data-stat-cell
            className={cn(
              'min-w-0 border-border-inner px-4 py-[14px] lg:border-b-0 lg:px-5 lg:py-[18px]',
              mobileRightRule ? 'border-r' : null,
              mobileBottomRule ? 'border-b' : null,
              index < count - 1 ? 'lg:border-r' : 'lg:border-r-0',
            )}
          >
            <p className="text-[12px] leading-[1.35] text-ink-muted lg:text-[13px]">{item.label}</p>
            <p
              data-numeric
              className={cn(
                'mt-[6px] font-display text-[26px] font-semibold tabular-nums lg:mt-2 lg:text-[30px] lg:tracking-[-0.03em]',
                toneClassName,
              )}
            >
              {item.value}
            </p>
            {item.hint ? (
              <p className={cn('mt-2 flex items-center gap-[6px] text-[13px]', trendUi.className)}>
                {trendUi.icon}
                <span>{item.hint}</span>
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
