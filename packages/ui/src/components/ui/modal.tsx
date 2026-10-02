'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { MicroLabel } from './page-section'

export type ModalSize = 'md' | 'lg' | 'xl' | 'full'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Mono micro label above the title, e.g. "Upload · step 2 of 2". */
  eyebrow?: string
  /** red for confirm-destructive dialogs ("Confirm"). */
  eyebrowTone?: 'teal' | 'red'
  /** Rendered beside the title, e.g. the flag-type pill in the review modal. */
  headerAccessory?: React.ReactNode
  /** Extra classes for the title h2 (2.9: Mono SKU title). */
  titleClassName?: string
  /** Extra classes for the scrolling body (2.9: `p-0` for its two-column grid). */
  bodyClassName?: string
  /** Accessible name; overrides the title-derived name (2.9: "Review discrepancy"). */
  'aria-label'?: string
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

// Storyboard 01 C13: the hero demo panel, lifted. r20 hairline + modal shadow
// over an ink 40% / blur 4 backdrop; eyebrow + Outfit 22 header; footer on the
// subtle fill.
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  eyebrowTone = 'teal',
  headerAccessory,
  titleClassName,
  bodyClassName,
  'aria-label': ariaLabel,
  children,
  footer,
  size = 'md',
}: ModalProps) {
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

  const hasHeader = Boolean(title || eyebrow)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        tabIndex={-1}
        className={cn(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-[20px] border border-border-panel bg-card text-card-foreground shadow-modal outline-none',
          sizeClasses[size],
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {hasHeader ? (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-inner px-[26px] py-[22px]">
            <div className="min-w-0">
              {eyebrow ? <MicroLabel tone={eyebrowTone === 'red' ? 'red' : 'teal'}>{eyebrow}</MicroLabel> : null}
              {title || headerAccessory ? (
                <div className={cn('flex flex-wrap items-center gap-[10px]', eyebrow ? 'mt-2' : null)}>
                  {title ? <h2 className={cn('text-[22px] leading-[normal]', titleClassName)}>{title}</h2> : null}
                  {headerAccessory}
                </div>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose} className="shrink-0">
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div className={cn('flex-1 overflow-y-auto px-[26px] py-[22px]', bodyClassName)}>{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-[10px] border-t border-border-inner bg-surface-subtle px-[26px] py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
