import * as React from 'react'
import { cn } from '../../lib/utils'

export function AppHeader({
  brand,
  badge,
  title,
  description,
  navigation,
  actions,
  className,
}: {
  brand?: React.ReactNode
  badge?: React.ReactNode
  title?: string
  description?: string
  navigation?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl', className)}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {brand}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {title ? <h1 className="truncate text-xl font-semibold">{title}</h1> : null}
                {badge}
              </div>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-3">{actions}</div>
        </div>
        {navigation ? <div className="flex flex-wrap items-center gap-2">{navigation}</div> : null}
      </div>
    </header>
  )
}
