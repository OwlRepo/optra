'use client'

import * as React from 'react'
import LineSidebar from '../LineSidebar'

export type JumpRailItem = {
  id: string
  label: string
}

function truncate(label: string, max = 26) {
  const clean = label.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || '…'
}

export function MessageJumpRail({
  items,
  onJump,
  className,
}: {
  items: JumpRailItem[]
  onJump: (id: string) => void
  className?: string
}) {
  if (items.length < 2) return null

  return (
    <div
      className={`pointer-events-auto max-h-[60vh] overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ''}`}
    >
      <LineSidebar
        items={items.map((item) => truncate(item.label))}
        accentColor="#5661df"
        textColor="#9ca0ab"
        markerColor="#3f4351"
        showIndex={false}
        showMarker
        markerLength={18}
        markerGap={4}
        itemGap={10}
        fontSize={0.68}
        proximityRadius={70}
        maxShift={10}
        onItemClick={(index) => onJump(items[index].id)}
      />
    </div>
  )
}
