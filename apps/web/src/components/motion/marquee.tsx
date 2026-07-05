'use client'

import * as React from 'react'
import { cn } from '@repo/ui'

type MarqueeProps = {
  children: React.ReactNode
  className?: string
  reverse?: boolean
  durationSeconds?: number
}

export function Marquee({ children, className, reverse = false, durationSeconds = 26 }: MarqueeProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_2%,black_98%,transparent)]',
        className,
      )}
    >
      <div
        className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]"
        style={{ animationDuration: `${durationSeconds}s`, animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        <div className="flex shrink-0 gap-3">{children}</div>
        <div className="flex shrink-0 gap-3" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  )
}
