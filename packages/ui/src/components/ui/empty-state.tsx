import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MicroLabel } from './page-section'

export type EmptyStateLabelTone = 'muted' | 'teal' | 'amber' | 'neutral'

// Storyboard 01 C11: the landing's dashed drop well, flush left. A Mono micro
// label carries the category (format, good news, role gate, blocker); the
// 56px icon tile is gone, so `icon` is accepted and not rendered.
export function EmptyState({
  icon: _icon,
  title,
  description,
  actions,
  label,
  labelTone = 'muted',
  nested = false,
  descriptionClassName,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description: string
  actions?: React.ReactNode
  /** e.g. "pdf / xlsx / csv", "All clear", "Owners & admins", "Needs a vendor first". */
  label?: string
  /** teal = good news (adds a 14px check), amber = blocker, neutral = role gate. */
  labelTone?: EmptyStateLabelTone
  /** Inside another panel: 14px radius instead of 18px. */
  nested?: boolean
  /** Screen-specific description width (frame 2.3 caps it at 52ch; the others run full width). */
  descriptionClassName?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'border border-dashed border-border-dashed bg-card p-7',
        nested ? 'rounded-[14px]' : 'rounded-[18px]',
        className,
      )}
    >
      {label ? (
        <MicroLabel
          tone={labelTone}
          icon={labelTone === 'teal' ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" /> : undefined}
          className={labelTone === 'teal' ? 'text-primary-strong-hover' : undefined}
        >
          {label}
        </MicroLabel>
      ) : null}
      <h3 className={cn('text-[20px] leading-[normal]', label ? 'mt-3' : null)}>{title}</h3>
      <p className={cn('mt-2 text-[15px] leading-[1.6] text-ink-body', descriptionClassName)}>{description}</p>
      {actions ? <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">{actions}</div> : null}
    </div>
  )
}
