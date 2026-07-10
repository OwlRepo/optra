'use client'

import * as React from 'react'
import { cn } from '../../lib/utils'

export interface TabItem {
  id: string
  label: string
  icon?: React.ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (id: string) => void
  'aria-label': string
  className?: string
}

export function Tabs({ items, value, onValueChange, className, ...ariaProps }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaProps['aria-label']}
      className={cn('inline-flex gap-1 rounded-full bg-secondary/60 p-1', className)}
    >
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (item.id !== value) onValueChange(item.id)
            }}
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
              selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
