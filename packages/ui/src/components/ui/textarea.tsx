import * as React from 'react'
import { cn } from '../../lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

// Storyboard 01 C04 "Decision note": min-height 104, padding 12px 14px, 15/1.6.
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[104px] w-full resize-y rounded-[12px] border border-border-panel bg-card px-[14px] py-3 text-[15px] leading-[1.6] text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-ink-muted focus-visible:border-primary-strong focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-segmented disabled:bg-surface-subtle disabled:text-ink-muted aria-invalid:border-destructive-tone',
        className,
      )}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Textarea }
