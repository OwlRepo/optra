'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@repo/ui'

export function ScrollToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Scroll to latest message"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
      className={cn(
        'absolute bottom-3 left-1/2 z-20 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-[var(--shadow-md)] backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out active:scale-[0.94]',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <ChevronDown className="size-5" />
    </button>
  )
}
