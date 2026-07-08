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
        className="animate-scrim-in fixed inset-0 bg-slate-950/55 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="animate-drawer-in relative z-10 flex h-full w-72 max-w-[85vw] flex-col justify-between border-r border-border/70 bg-secondary px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] outline-none"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close navigation"
          onClick={onClose}
          className="absolute right-2 top-[calc(0.5rem+env(safe-area-inset-top))] size-9 rounded-full p-0"
        >
          <X className="size-4" />
        </Button>
        <div className="min-w-0 space-y-6 pr-10">
          <div className="flex min-w-0">{sidebarHeader({ collapsed: false })}</div>
          {navigation({ collapsed: false })}
        </div>
        <div className="space-y-3">
          {userFooter ? userFooter({ collapsed: false }) : null}
          {onLogout ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-label="Log out"
              onClick={() => {
                const result = onLogout()
                if (result && typeof result === 'object' && 'catch' in result && typeof result.catch === 'function') {
                  void result.catch(() => {})
                }
              }}
            >
              <LogOut className="size-4" />
              Log out
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
