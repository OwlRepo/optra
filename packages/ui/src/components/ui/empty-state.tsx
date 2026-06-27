import * as React from 'react'
import { cn } from '../../lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-[calc(var(--radius)+0.25rem)] border border-dashed border-border/80 bg-secondary/40 px-6 py-12 text-center', className)}>
      {icon ? (
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-primary shadow-[var(--shadow-sm)]">
          {icon}
        </div>
      ) : null}
      <div className="max-w-md space-y-2">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
    </div>
  )
}
