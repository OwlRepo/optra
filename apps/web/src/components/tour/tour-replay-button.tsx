'use client'

import * as React from 'react'
import { Button, cn } from '@repo/ui'
import { Compass } from 'lucide-react'
import { TOUR_ANCHORS, tourAttr } from './tour-anchors'
import { useTour } from './tour-context'

// Rendered through AppShell's `userFooter` slot, so it sits above the divider
// over Log out in both the desktop sidebar and the mobile drawer. Styled like
// the Log out button it stacks on.
export function TourReplayButton({ collapsed }: { collapsed: boolean }) {
  const tour = useTour()
  if (!tour) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size={collapsed ? 'icon' : 'sm'}
      aria-label={collapsed ? 'Take the tour' : undefined}
      onClick={(event) => tour.startTour(event.currentTarget)}
      {...tourAttr(TOUR_ANCHORS.replay)}
      className={cn(
        'text-ink-ghost hover:bg-card hover:text-foreground',
        collapsed ? 'size-10 rounded-[10px]' : 'w-full justify-start gap-2 px-2.5',
      )}
    >
      <Compass className="size-4" aria-hidden="true" />
      {collapsed ? null : 'Take the tour'}
    </Button>
  )
}
