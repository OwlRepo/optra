import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

// Storyboard 01 C02. One teal action per view: default (and the retired
// accent) is --primary-strong. No shadows except the lg CTA, no scale-on-press.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong disabled:pointer-events-none disabled:opacity-45 aria-busy:opacity-85 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover',
        destructive: 'bg-destructive-strong text-white hover:bg-destructive-strong-text',
        outline: 'border border-border-panel bg-card text-foreground hover:border-primary-strong/50',
        secondary: 'bg-secondary text-foreground hover:bg-secondary-hover',
        ghost: 'bg-transparent text-ink-ghost hover:bg-secondary hover:text-foreground',
        link: 'text-primary-strong underline decoration-primary-strong/40 underline-offset-4 hover:text-primary-strong-hover',
        accent: 'bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover',
      },
      size: {
        // leading-[normal] follows the font size: tailwind-merge drops a
        // line-height that precedes a font-size class.
        default: 'h-[42px] rounded-[12px] px-[18px] text-[15px] leading-[normal]',
        xs: 'h-8 rounded-[9px] px-3 text-[13px] leading-[normal]',
        sm: 'h-9 rounded-[10px] px-[14px] text-[14px] leading-[normal]',
        lg: 'h-[52px] gap-[10px] rounded-[14px] px-[26px] text-[16px] leading-[normal]',
        xl: 'h-[52px] gap-[10px] rounded-[14px] px-[26px] text-[16px] leading-[normal]',
        icon: 'size-9 rounded-[10px] p-0 leading-[normal]',
      },
    },
    compoundVariants: [
      { variant: ['default', 'accent'], size: ['lg', 'xl'], class: 'shadow-cta' },
      { variant: 'ghost', size: 'default', class: 'px-[14px]' },
      { variant: 'ghost', size: 'icon', class: 'hover:text-primary-strong' },
      { variant: 'link', class: 'h-auto rounded-none p-0' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className,
    variant,
    size,
    asChild = false,
    isLoading = false,
    loadingText,
    children,
    disabled,
    ...props
  }, ref) => {
    const Comp = asChild ? Slot : 'button'

    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      )
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading ? <Loader2 className="animate-[spin_0.9s_linear_infinite]" aria-hidden="true" /> : null}
        {isLoading && loadingText ? loadingText : children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
