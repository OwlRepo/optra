'use client'

import * as React from 'react'
import { prefersReducedMotion } from '@/hooks/use-in-view'
import ScrambledText from '../ScrambledText'

interface ExtractionRevealProps {
  children: string
  className?: string
}

export function ExtractionReveal({ children, className }: ExtractionRevealProps) {
  const [scrambleEnabled, setScrambleEnabled] = React.useState(false)

  React.useEffect(() => {
    setScrambleEnabled(!prefersReducedMotion())
  }, [])

  if (!scrambleEnabled) {
    return <p className={className}>{children}</p>
  }

  return (
    <ScrambledText
      className={`!m-0 !max-w-none !text-sm !text-foreground ${className ?? ''}`}
      radius={60}
      duration={0.6}
    >
      {children}
    </ScrambledText>
  )
}
