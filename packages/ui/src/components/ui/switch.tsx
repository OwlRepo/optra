import * as React from 'react'
import { cn } from '../../lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  id?: string
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

// Storyboard 03 frame 3.10 (C04 switch): 44x26 teal track, 20px white knob
// inset 3px. A real button with role="switch" so keyboard and screen readers
// get the state from aria-checked.
export function Switch({ checked, onCheckedChange, id, disabled = false, className, ...ariaProps }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaProps['aria-label']}
      aria-labelledby={ariaProps['aria-labelledby']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-11 shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-primary-strong' : 'bg-ink-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[3px] size-5 rounded-full bg-card shadow-knob transition-[left] duration-200',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}
