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
  /** Focus target on close; falls back to the element focused before open. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(',')

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('tabindex') !== '-1' && !el.hasAttribute('disabled') && !el.hidden,
  )
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
  returnFocusRef,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const onCloseRef = React.useRef(onClose)
  const returnFocusRefRef = React.useRef(returnFocusRef)

  React.useEffect(() => {
    returnFocusRefRef.current = returnFocusRef
  }, [returnFocusRef])

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = getFocusable(panel)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || active === panel || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const target = returnFocusRefRef.current?.current
      if (target?.isConnected) target.focus()
      else if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
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
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-[20px] border border-border-panel bg-card leading-[normal] text-card-foreground shadow-modal outline-none',
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
