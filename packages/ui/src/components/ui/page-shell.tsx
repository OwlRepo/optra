import * as React from 'react'
import { cn } from '../../lib/utils'

// The landing has no decoration, so neither does the app (frame 3.1 note):
// the noise, grid and blob layers are gone; only the centred container stays.
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
    <div className={cn('relative min-h-screen', className)}>
      <div className={cn('relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', contentClassName)}>{children}</div>
    </div>
  )
}
