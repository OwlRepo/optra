'use client'

import * as React from 'react'
import { prefersReducedMotion } from '@/hooks/use-in-view'
import BorderGlow from '../BorderGlow'

interface DiscrepancyChipProps {
  children: React.ReactNode
  className?: string
}

export function DiscrepancyChip({ children, className }: DiscrepancyChipProps) {
  const [animated, setAnimated] = React.useState(false)

  React.useEffect(() => {
    setAnimated(!prefersReducedMotion())
  }, [])

  return (
    <BorderGlow
      backgroundColor="transparent"
      colors={['#1FB6A3', '#0F8A7E']}
      borderRadius={16}
      fillOpacity={0.35}
      edgeSensitivity={40}
      animated={animated}
      className={className ?? 'inline-flex w-fit'}
    >
      {children}
    </BorderGlow>
  )
}
