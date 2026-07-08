'use client'

import * as React from 'react'
import ShinyText from '../ShinyText'
import Strands from '../Strands'

export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-muted-foreground">
      <span className="relative inline-block size-6 shrink-0 overflow-hidden rounded-full">
        <Strands
          colors={['#5661df', '#8b7ff0', '#06b6d4']}
          count={3}
          speed={0.8}
          amplitude={1.4}
          waviness={1.2}
          thickness={1.2}
          glow={3}
          scale={0.55}
          opacity={0.9}
        />
      </span>
      <ShinyText text={label} speed={1.4} color="#8a8f9c" shineColor="#f4f4f5" />
    </p>
  )
}
