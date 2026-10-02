'use client'

import * as React from 'react'
import { LogOut, X } from 'lucide-react'
import { Button } from './button'

type CollapsibleSlot = (args: { collapsed: boolean }) => React.ReactNode

export interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  sidebarHeader: CollapsibleSlot
  navigation: CollapsibleSlot
  userFooter?: CollapsibleSlot
  onLogout?: () => void | Promise<void>
}

export function MobileNavDrawer({ open, onClose, sidebarHeader, navigation, userFooter, onLogout }: MobileNavDrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const onCloseRef = React.useRef(onClose)

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) return

    panelRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex lg:hidden">
      <div
        data-testid="mobile-nav-scrim"
        className="animate-scrim-in fixed inset-0 bg-foreground/40 backdrop-blur-[4px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="animate-drawer-in relative z-10 flex h-full w-[300px] max-w-[85vw] flex-col justify-between gap-6 border-r border-border bg-secondary px-3.5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))] outline-none"
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-[22px] overflow-y-auto">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1">{sidebarHeader({ collapsed: false })}</div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Close navigation"
              onClick={onClose}
              className="size-10 shrink-0 rounded-[10px] bg-card text-ink-ghost"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="[&_a]:min-h-11 [&_a]:py-[11px]">{navigation({ collapsed: false })}</div>
        </div>
        <div className="flex flex-col gap-3">
          {userFooter ? userFooter({ collapsed: false }) : null}
          {onLogout ? (
            <div className="flex items-center border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 gap-2 px-2.5 text-ink-ghost hover:bg-card hover:text-foreground"
                aria-label="Log out"
                onClick={() => {
                  const result = onLogout()
                  if (result && typeof result === 'object' && 'catch' in result && typeof result.catch === 'function') {
                    void result.catch(() => {})
                  }
                }}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Log out
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
