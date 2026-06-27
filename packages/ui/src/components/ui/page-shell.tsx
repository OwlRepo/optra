import * as React from 'react'
import { cn } from '../../lib/utils'

export function PageShell({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={cn('relative min-h-screen overflow-hidden', className)}>
      <div className="noise-overlay pointer-events-none absolute inset-0 opacity-50" />
      <div className="app-grid pointer-events-none absolute inset-0 text-foreground/10" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      <div className={cn('relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', contentClassName)}>{children}</div>
    </div>
  )
}
