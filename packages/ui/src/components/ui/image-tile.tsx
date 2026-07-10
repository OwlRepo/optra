'use client'

import * as React from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Skeleton } from './skeleton'

const aspectClassName = {
  square: 'aspect-square',
  video: 'aspect-video',
  // Tailwind v4 has no built-in 4:3 utility — this bracket literal is a
  // layout-ratio exception, not a color/spacing violation.
  photo: 'aspect-[4/3]',
} as const

export interface ImageTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  src?: string | null
  alt: string
  aspect?: 'square' | 'video' | 'photo'
  caption?: string
  badge?: React.ReactNode
  isLoading?: boolean
}

const ImageTile = React.forwardRef<HTMLDivElement, ImageTileProps>(
  ({ src, alt, aspect = 'square', caption, badge, isLoading = false, className, ...props }, ref) => {
    const [errored, setErrored] = React.useState(false)

    // Reset the error state if a new src comes in, so a previously-broken
    // tile can recover when the caller passes a working src.
    React.useEffect(() => {
      setErrored(false)
    }, [src])

    if (isLoading) {
      return (
        <div
          ref={ref}
          className={cn('relative overflow-hidden rounded-2xl', aspectClassName[aspect], className)}
          {...props}
        >
          <Skeleton data-testid="image-tile-skeleton" className="h-full w-full" />
        </div>
      )
    }

    const hasImage = Boolean(src) && !errored
    const showOverlay = Boolean(caption) || Boolean(badge)

    return (
      <div
        ref={ref}
        className={cn('relative overflow-hidden rounded-2xl', aspectClassName[aspect], className)}
        {...props}
      >
        {hasImage ? (
          <img
            src={src as string}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <div
            data-testid="image-tile-fallback"
            className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground"
          >
            <ImageOff className="size-6" aria-hidden="true" />
          </div>
        )}
        {showOverlay ? (
          // Raw black/white overlay colors are intentional here — this is
          // legibility-over-arbitrary-photo, not a themed surface. Flagged
          // for design-review sign-off, not silently treated as compliant.
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-xs font-medium text-white">
            {caption ? <span className="truncate">{caption}</span> : <span />}
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
        ) : null}
      </div>
    )
  }
)
ImageTile.displayName = 'ImageTile'

export { ImageTile }
