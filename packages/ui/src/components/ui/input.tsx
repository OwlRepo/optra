import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

// Storyboard 01 C04: flat white well, 12px radius, teal border + 3px halo on
// focus, red border when aria-invalid. Codes and IDs pass font-mono from the
// call site.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-[42px] w-full rounded-[12px] border border-border-panel bg-card px-[14px] text-[15px] text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-ink-muted focus-visible:border-primary-strong focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-segmented disabled:bg-surface-subtle disabled:text-ink-muted aria-invalid:border-destructive-tone file:border-0 file:bg-transparent file:text-[14px] file:font-medium',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
