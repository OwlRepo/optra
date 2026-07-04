'use client'

import * as React from 'react'
import { cn } from '../../lib/utils'

export type ModalSize = 'md' | 'lg' | 'xl' | 'full'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: ModalSize
}

const sizeClasses: Record<ModalSize, string> = {
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[80vw]',
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const onCloseRef = React.useRef(onClose)

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) return

    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'flex max-h-[85vh] w-full flex-col rounded-[calc(var(--radius)+0.25rem)] border border-border/70 bg-card text-card-foreground shadow-[var(--shadow-lg)] outline-none',
          sizeClasses[size],
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? (
          <div className="shrink-0 border-b border-border/60 px-6 py-4">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border/60 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  )
}
