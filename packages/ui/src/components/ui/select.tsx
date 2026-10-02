import * as React from 'react'
import { cn } from '../../lib/utils'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

// Storyboard 01 C04: still a native <select> (ids, labels and Playwright
// selectors keep working); native chrome removed and a 16px chevron drawn at
// right 14px by the .select-chevron utility in globals.css.
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        'select-chevron block h-[42px] w-full appearance-none rounded-[12px] border border-border-panel bg-card pl-[14px] pr-10 text-[15px] text-foreground outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-primary-strong focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-segmented disabled:bg-surface-subtle disabled:text-ink-muted aria-invalid:border-destructive-tone',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})
Select.displayName = 'Select'

export { Select }
