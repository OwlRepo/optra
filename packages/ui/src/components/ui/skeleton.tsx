import * as React from 'react'
import { cn } from '../../lib/utils'

// Storyboard 01 C12: skeleton block (radius 8) with the hero demo's rf-sweep
// teal band (.skeleton-sweep in globals.css). Honours prefers-reduced-motion
// through the global rule.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton-sweep rounded-[8px] bg-surface-skeleton', className)} {...props} />
}

// Bar widths per row, copied from the C12 frame; the pattern repeats.
const rowBarWidths = [
  ['w-full', 'w-full', 'w-[70%]', 'w-1/2'],
  ['w-[80%]', 'w-[60%]', 'w-[60%]', 'w-[40%]'],
  ['w-[90%]', 'w-[70%]', 'w-[65%]', 'w-[45%]'],
] as const

const FOUR_COLUMN_TEMPLATE = '1.4fr 1fr 0.8fr 0.6fr'

export interface SkeletonRowsProps {
  rows?: number
  columns?: number
  className?: string
}

// Loading shaped like the result: rows of 14px bars (the third column is a
// pill), each row on an inner rule. Bars only -- the caller supplies the
// panel (e.g. a Table container or Card). Only the first bar of each row
// sweeps, staggered 0.2s per row.
function SkeletonRows({ rows = 3, columns = 4, className }: SkeletonRowsProps) {
  const rowCount = Math.max(0, Math.trunc(rows))
  const columnCount = Math.max(1, Math.trunc(columns))
  const template = columnCount === 4 ? FOUR_COLUMN_TEMPLATE : `repeat(${columnCount}, minmax(0, 1fr))`

  return (
    <div aria-hidden="true" data-skeleton-rows className={cn(className)}>
      {Array.from({ length: rowCount }, (_, row) => {
        const widths = rowBarWidths[row % rowBarWidths.length]
        return (
          <div
            key={row}
            data-skeleton-row
            className="grid gap-[18px] border-t border-border-inner px-[18px] py-4"
            style={{ gridTemplateColumns: template }}
          >
            {Array.from({ length: columnCount }, (_, column) => {
              const shape = cn(
                'h-[14px]',
                widths[column % widths.length],
                column % 4 === 2 ? 'rounded-full' : 'rounded-[8px]',
              )
              if (column === 0) {
                return (
                  <Skeleton
                    key={column}
                    data-skeleton-bar
                    className={shape}
                    style={{ '--skeleton-delay': `${row * 0.2}s` } as React.CSSProperties}
                  />
                )
              }
              return <div key={column} data-skeleton-bar className={cn(shape, 'bg-surface-skeleton')} />
            })}
          </div>
        )
      })}
    </div>
  )
}

export { Skeleton, SkeletonRows }
