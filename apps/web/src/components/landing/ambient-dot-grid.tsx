'use client'

import * as React from 'react'
import { prefersReducedMotion } from '@/hooks/use-in-view'
import DotGrid from '../DotGrid'

interface AmbientDotGridProps {
  className?: string
}

export function AmbientDotGrid({ className }: AmbientDotGridProps) {
  const [showLive, setShowLive] = React.useState(false)

  React.useEffect(() => {
    if (!prefersReducedMotion()) setShowLive(true)
  }, [])

  if (!showLive) {
    return (
      <div
        data-testid="ambient-dot-grid-static"
        aria-hidden="true"
        className={className}
        style={{
          backgroundImage: 'radial-gradient(oklch(from var(--primary) l c h / 0.15) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
    )
  }

  return (
    <div aria-hidden="true" className={className}>
      <DotGrid
        baseColor="#0F8A7E"
        activeColor="#1FB6A3"
        dotSize={3}
        gap={24}
        proximity={90}
        className="opacity-40"
      />
    </div>
  )
}
