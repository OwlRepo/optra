import * as React from 'react'
import { cn } from '../../lib/utils'
import { EmptyState } from './empty-state'
import { ImageTile } from './image-tile'

export interface PhotoGridItem {
  id: string
  src?: string | null
  alt: string
  caption?: string
  badge?: React.ReactNode
}

export interface PhotoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  items: PhotoGridItem[]
  maxCols?: 2 | 3 | 4 | 5
  isLoading?: boolean
  loadingCount?: number
  emptyState?: React.ReactNode
}

// New pattern in this repo: maxCols is a numeric prop mapped to a precomputed
// Tailwind class set via a lookup object, rather than interpolating the
// number into a class string (Tailwind's static class scanner can't see
// dynamically-built class names, so the full class strings must be literal).
const colsMap: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
}

export function PhotoGrid({
  items,
  maxCols = 4,
  isLoading = false,
  loadingCount,
  emptyState,
  className,
  ...props
}: PhotoGridProps) {
  const gridClassName = cn('grid gap-4', colsMap[maxCols], className)

  // Loading state wins regardless of whether items is also non-empty —
  // callers may pass stale items while a refetch is in flight.
  if (isLoading) {
    const count = loadingCount ?? maxCols
    return (
      <div className={gridClassName} {...props}>
        {Array.from({ length: count }).map((_, index) => (
          <div key={`photo-grid-loading-${index}`} data-testid="photo-grid-tile-loading">
            <ImageTile isLoading alt="" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={cn(className)} {...props}>
        {emptyState ?? (
          <EmptyState title="No photos yet" description="Photos will appear here once available." />
        )}
      </div>
    )
  }

  return (
    <div className={gridClassName} {...props}>
      {items.map((item) => (
        <div key={item.id} data-testid="photo-grid-tile">
          <ImageTile src={item.src} alt={item.alt} caption={item.caption} badge={item.badge} />
        </div>
      ))}
    </div>
  )
}
