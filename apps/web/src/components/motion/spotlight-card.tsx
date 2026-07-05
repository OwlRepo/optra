'use client'

import * as React from 'react'
import { Card, type CardProps, cn } from '@repo/ui'

export const SpotlightCard = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, onMouseMove, children, ...props }, ref) => {
    const [pos, setPos] = React.useState({ x: 50, y: 0 })

    return (
      <Card
        ref={ref}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPos({
            x: ((event.clientX - rect.left) / rect.width) * 100,
            y: ((event.clientY - rect.top) / rect.height) * 100,
          })
          onMouseMove?.(event)
        }}
        className={cn('group/spotlight relative isolate overflow-hidden', className)}
        style={{ '--spot-x': `${pos.x}%`, '--spot-y': `${pos.y}%` } as React.CSSProperties}
        {...props}
      >
        <div
          aria-hidden="true"
          data-spotlight-glow
          className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover/spotlight:opacity-100"
          style={{
            background:
              'radial-gradient(280px circle at var(--spot-x) var(--spot-y), oklch(from var(--primary) l c h / 0.12), transparent 70%)',
          }}
        />
        <div className="relative z-10">{children}</div>
      </Card>
    )
  },
)
SpotlightCard.displayName = 'SpotlightCard'
