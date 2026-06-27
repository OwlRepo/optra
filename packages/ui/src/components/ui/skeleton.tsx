import * as React from 'react'
import { cn } from '../../lib/utils'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-secondary before:absolute before:inset-0 before:shimmer',
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
