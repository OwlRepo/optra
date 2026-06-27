import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)-0.25rem)] text-sm font-medium transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[var(--shadow-md)] hover:bg-primary/92 hover:shadow-[var(--shadow-lg)]',
        destructive: 'bg-destructive text-destructive-foreground shadow-[var(--shadow-md)] hover:bg-destructive/92',
        outline: 'border border-border bg-background/90 text-foreground shadow-[var(--shadow-sm)] hover:border-primary/30 hover:bg-primary/5 hover:text-primary',
        secondary: 'bg-secondary text-secondary-foreground shadow-[var(--shadow-sm)] hover:bg-secondary/85',
        ghost: 'text-foreground hover:bg-secondary hover:text-foreground',
        link: 'h-auto rounded-none p-0 text-primary underline-offset-4 hover:underline',
        accent: 'bg-accent text-accent-foreground shadow-[var(--shadow-md)] hover:bg-accent/92',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-xl px-3 text-xs',
        lg: 'h-12 rounded-2xl px-6 text-sm',
        xl: 'h-14 rounded-2xl px-7 text-base',
        icon: 'h-10 w-10 rounded-xl',
      },
    },
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
        {isLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {isLoading && loadingText ? loadingText : children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
