import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

// Storyboard 01 C03: four tones borrowed from the hero match demo, the Mono
// chip, and solid verdicts. Legacy variant names map onto the tones.
const TEAL = 'border-primary-strong/30 bg-primary-strong/8 text-primary-strong-hover'
const AMBER = 'border-flag/40 bg-flag/10 text-flag-strong'
const RED = 'border-destructive-tone/35 bg-destructive-tone/8 text-destructive-strong-text'
const NEUTRAL = 'border-border-panel bg-secondary text-ink-neutral'
const CHIP =
  'rounded-[7px] border-border-panel bg-surface-subtle px-2 py-1 font-mono text-[10px] font-normal uppercase leading-[normal] tracking-[0.1em] text-ink-neutral'
const SOLID = 'border-0 px-[11px] py-[5px] text-[11px] uppercase leading-[normal] tracking-[0.06em] text-white'

const badgeVariants = cva(
  'inline-flex items-center gap-[6px] whitespace-nowrap rounded-full border px-[10px] py-[3px] text-[12px] font-semibold leading-[normal] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong',
  {
    variants: {
      variant: {
        default: TEAL,
        success: TEAL,
        teal: TEAL,
        warning: AMBER,
        amber: AMBER,
        destructive: RED,
        red: RED,
        secondary: NEUTRAL,
        neutral: NEUTRAL,
        outline: CHIP,
        chip: CHIP,
        'solid-teal': `${SOLID} bg-primary-strong`,
        'solid-amber': `${SOLID} bg-flag`,
        'solid-red': `${SOLID} bg-destructive-tone`,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  /** Processing state: a 6px teal dot pulsing opacity 1 to 0.35 every 1.4s. */
  pulse?: boolean
}

// data-pulse on the root is a plain DOM hook so page specs can assert the
// processing state without mocking Badge.
function Badge({ className, variant, pulse = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} data-pulse={pulse ? '' : undefined} {...props}>
      {pulse ? (
        <span data-pulse-dot aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-primary-strong animate-op-pulse" />
      ) : null}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
