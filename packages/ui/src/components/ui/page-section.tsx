import * as React from 'react'
import { cn } from '../../lib/utils'

const eyebrowToneClassName = {
  teal: 'text-primary-strong',
  red: 'text-destructive-strong-text',
  amber: 'text-flag-strong',
} as const

export interface EyebrowProps {
  children: React.ReactNode
  /** Page-level eyebrow: a 24px rule before the text (C01 "With rule"). */
  rule?: boolean
  tone?: keyof typeof eyebrowToneClassName
  className?: string
}

// C01 eyebrow: JetBrains Mono 11px, 0.16em, uppercase, teal.
export function Eyebrow({ children, rule = false, tone = 'teal', className }: EyebrowProps) {
  return (
    <p
      className={cn(
        'flex items-center gap-[10px] font-mono text-[11px] uppercase leading-[normal] tracking-[0.16em]',
        eyebrowToneClassName[tone],
        className,
      )}
    >
      {rule ? <span aria-hidden="true" data-eyebrow-rule className="h-px w-6 shrink-0 bg-current" /> : null}
      {children}
    </p>
  )
}

const microLabelToneClassName = {
  muted: 'text-ink-muted',
  teal: 'text-primary-strong',
  amber: 'text-flag-strong',
  neutral: 'text-ink-neutral',
  red: 'text-destructive-strong-text',
} as const

export interface MicroLabelProps {
  children: React.ReactNode
  tone?: keyof typeof microLabelToneClassName
  icon?: React.ReactNode
  as?: 'p' | 'span'
  className?: string
}

// C01 micro label: JetBrains Mono 10px, 0.14em, uppercase.
export function MicroLabel({ children, tone = 'muted', icon, as = 'p', className }: MicroLabelProps) {
  const Comp = as
  return (
    <Comp
      className={cn(
        'font-mono text-[10px] uppercase leading-[normal] tracking-[0.14em]',
        icon ? (as === 'span' ? 'inline-flex items-center gap-2' : 'flex items-center gap-2') : null,
        microLabelToneClassName[tone],
        className,
      )}
    >
      {icon}
      {children}
    </Comp>
  )
}

// C07 section header at app scale: eyebrow -> mt12 H2 28/1.08 -> mt10 15/1.65
// body, actions bottom-right.
export function PageSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-5', className)}>
      {(eyebrow || title || description || actions) ? (
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="max-w-[56ch]">
            {eyebrow ? (typeof eyebrow === 'string' ? <Eyebrow>{eyebrow}</Eyebrow> : <div>{eyebrow}</div>) : null}
            {title ? (
              typeof title === 'string' ? (
                <h2 className={cn('text-[28px] leading-[1.08]', eyebrow ? 'mt-3' : null)}>{title}</h2>
              ) : (
                <div className={cn(eyebrow ? 'mt-3' : null)}>{title}</div>
              )
            ) : null}
            {description ? (
              <div className={cn('text-[15px] leading-[1.65] text-ink-body', eyebrow || title ? 'mt-[10px]' : null)}>
                {description}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-[10px]">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
