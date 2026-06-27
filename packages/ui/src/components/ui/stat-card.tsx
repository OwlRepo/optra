import * as React from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Card } from './card'

type Trend = 'up' | 'down' | 'neutral'

const trendStyles: Record<Trend, { icon: React.ReactNode; className: string }> = {
  up: {
    icon: <ArrowUpRight className="size-4" />,
    className: 'text-emerald-600 dark:text-emerald-300',
  },
  down: {
    icon: <ArrowDownRight className="size-4" />,
    className: 'text-destructive',
  },
  neutral: {
    icon: <ArrowRight className="size-4" />,
    className: 'text-muted-foreground',
  },
}

export function StatCard({
  label,
  value,
  hint,
  trend = 'neutral',
  icon,
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
    <Card variant="elevated" className={cn('group p-6', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="font-display text-4xl font-semibold leading-none tabular-nums" data-numeric>
            {value}
          </div>
        </div>
        {icon ? (
          <div className="flex size-11 items-center justify-center rounded-2xl border border-primary/10 bg-primary/10 text-primary shadow-[var(--shadow-sm)]">
            {icon}
          </div>
        ) : null}
      </div>
      {hint ? (
        <div className={cn('mt-5 flex items-center gap-2 text-sm', trendUi.className)}>
          {trendUi.icon}
          <span>{hint}</span>
        </div>
      ) : null}
    </Card>
  )
}
