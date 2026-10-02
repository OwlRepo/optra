import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import { Eyebrow } from './page-section'

// Storyboard 01 C06: borders only. Five legacy variants collapse into Panel
// (white), Inset (subtle fill) and Ghost. No blur, no shadow, no gradient.
const PANEL = 'border border-border-panel bg-card'
const INSET = 'border border-border-panel bg-surface-subtle'

const cardVariants = cva('rounded-[18px] text-card-foreground', {
  variants: {
    variant: {
      default: PANEL,
      elevated: PANEL,
      gradient: PANEL,
      panel: PANEL,
      subtle: INSET,
      inset: INSET,
      ghost: 'border border-transparent bg-transparent',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-2 p-6', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-display text-[20px] font-semibold tracking-[-0.035em]', className)} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-[14px] leading-[1.6] text-ink-body', className)} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

export interface PanelHeaderProps {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  titleAs?: 'h2' | 'h3'
  className?: string
}

// Panel header (C06 / frame 2.1): Mono teal eyebrow, Outfit 22 title, one line
// of body, action bottom-right, inner rule below. The body sits flush under it.
function PanelHeader({ eyebrow, title, description, action, titleAs = 'h2', className }: PanelHeaderProps) {
  const Title = titleAs
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border-inner px-6 py-[22px]',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Title className={cn('text-[22px] leading-[normal]', eyebrow ? 'mt-[10px]' : null)}>{title}</Title>
        {description ? <p className="mt-2 text-[14px] text-ink-body">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-[10px]">{action}</div> : null}
    </div>
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, PanelHeader, cardVariants }
