'use client'

import * as React from 'react'
import { cn } from '../../lib/utils'

export interface TabItem {
  id: string
  label: string
  icon?: React.ReactNode
  /** Optional Mono count from a list the page already loaded. */
  count?: number
  /** Shorter label shown below lg (frame 4.2); the accessible name stays `label`. */
  shortLabel?: string
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (id: string) => void
  'aria-label': string
  /** Stretch the track and split it evenly below lg (frame 4.2). */
  fullWidth?: boolean
  className?: string
}

export interface SegmentedOption {
  value: string
  label: string
  count?: number
}

export interface SegmentedControlProps {
  options: SegmentedOption[]
  value: string
  onValueChange: (value: string) => void
  'aria-label': string
  /** md = frame 2.7 (option 7px 14px); sm = frame 2.11 compact (track p3 r11, option 6px 12px r8 13px). */
  size?: 'md' | 'sm'
  /** Stretch the track and split it evenly (frame 4.2, mobile). Wins over size. */
  fullWidth?: boolean
  className?: string
}

// Storyboard 01 C05: the landing's quiet segmented track. Active = white,
// teal label, 1px lift (shadow-segmented). Shared by Tabs and SegmentedControl.
const trackClassName = 'rounded-[12px] border border-border-segmented bg-surface-segmented'
const optionClassName =
  'inline-flex items-center gap-2 rounded-[9px] text-[14px] font-medium leading-[normal] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong'
const optionActiveClassName = 'bg-card text-primary-strong shadow-segmented'
const optionIdleClassName = 'bg-transparent text-[oklch(0.5_0.02_264)] hover:text-foreground'

function OptionCount({ count, active }: { count: number; active: boolean }) {
  // aria-hidden keeps the accessible name equal to the label ("Purchase
  // Orders"), so existing role/name selectors keep matching.
  return (
    <span aria-hidden="true" className={cn('font-mono text-[11px]', active ? 'text-ink-muted' : 'text-[oklch(0.6_0.02_264)]')}>
      {count}
    </span>
  )
}

export function Tabs({ items, value, onValueChange, fullWidth = false, className, ...ariaProps }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaProps['aria-label']}
      className={cn(
        fullWidth ? 'flex w-full p-1 lg:inline-flex lg:w-auto lg:self-start' : 'inline-flex self-start p-1',
        trackClassName,
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={item.shortLabel ? item.label : undefined}
            onClick={() => {
              if (item.id !== value) onValueChange(item.id)
            }}
            className={cn(
              optionClassName,
              'px-4 py-2',
              fullWidth && 'flex-1 justify-center lg:flex-none',
              selected ? optionActiveClassName : optionIdleClassName,
            )}
          >
            {item.icon}
            {item.shortLabel ? (
              <>
                <span className="lg:hidden">{item.shortLabel}</span>
                <span className="hidden lg:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
            {typeof item.count === 'number' ? <OptionCount count={item.count} active={selected} /> : null}
          </button>
        )
      })}
    </div>
  )
}

// A filter, not navigation: role="radiogroup" with roving tabindex and arrow
// keys (WAI-ARIA radio group). Replaces status <Select>s (frames 2.7, 2.11).
export function SegmentedControl({
  options,
  value,
  onValueChange,
  size = 'md',
  fullWidth = false,
  className,
  ...ariaProps
}: SegmentedControlProps) {
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const checkedIndex = options.findIndex((option) => option.value === value)
  const tabbableIndex = checkedIndex === -1 ? 0 : checkedIndex

  const moveTo = (index: number) => {
    const option = options[index]
    if (!option) return
    optionRefs.current[index]?.focus()
    if (option.value !== value) onValueChange(option.value)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    moveTo(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaProps['aria-label']}
      className={cn(
        trackClassName,
        fullWidth
          ? cn(
              'flex w-full p-[3px] lg:inline-flex lg:w-auto lg:self-start',
              size === 'sm' ? 'lg:rounded-[11px]' : 'lg:p-1',
            )
          : size === 'sm'
            ? 'inline-flex self-start rounded-[11px] p-[3px]'
            : 'inline-flex self-start p-1',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              optionRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => {
              if (!checked) onValueChange(option.value)
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              optionClassName,
              fullWidth
                ? cn(
                    'flex-1 justify-center px-[6px] py-[9px] text-[13px] leading-[normal] lg:flex-none',
                    size === 'sm'
                      ? 'lg:rounded-[8px] lg:px-3 lg:py-[6px]'
                      : 'lg:px-[14px] lg:py-[7px] lg:text-[14px]',
                  )
                : size === 'sm'
                  ? 'rounded-[8px] px-3 py-[6px] text-[13px] leading-[normal]'
                  : 'px-[14px] py-[7px]',
              checked ? optionActiveClassName : optionIdleClassName,
            )}
          >
            {option.label}
            {typeof option.count === 'number' ? <OptionCount count={option.count} active={checked} /> : null}
          </button>
        )
      })}
    </div>
  )
}
