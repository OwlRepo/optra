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
  /** A string renders as one Mono 11 line; a node (frame 3.6: SKU + description) renders as given. */
  caption?: React.ReactNode
  badge?: React.ReactNode
  isLoading?: boolean
}

// Storyboard 01 C17 / frame 3.6: r12 frame with a hairline; the caption is a
// Mono line BELOW the photo (the black gradient overlay is gone). The frame
// carries data-image-frame so a parent can retone its border (PhotoCompare).
const ImageTile = React.forwardRef<HTMLDivElement, ImageTileProps>(
  ({ src, alt, aspect = 'square', caption, badge, isLoading = false, className, ...props }, ref) => {
    const [errored, setErrored] = React.useState(false)

    // Reset the error state if a new src comes in, so a previously-broken
    // tile can recover when the caller passes a working src.
    React.useEffect(() => {
      setErrored(false)
    }, [src])

    const hasImage = Boolean(src) && !errored
    const showCaption = !isLoading && (Boolean(caption) || Boolean(badge))

    return (
      <div ref={ref} className={cn('min-w-0', className)} {...props}>
        <div
          data-image-frame
          className={cn(
            'relative overflow-hidden rounded-[12px]',
            aspectClassName[aspect],
            isLoading ? null : 'border border-border-segmented',
          )}
        >
          {isLoading ? (
            <Skeleton data-testid="image-tile-skeleton" className="h-full w-full rounded-none" />
          ) : hasImage ? (
            <img
              src={src as string}
              alt={alt}
              loading="lazy"
              className="block h-full w-full object-cover"
              onError={() => setErrored(true)}
            />
          ) : (
            <div
              data-testid="image-tile-fallback"
              className="flex h-full w-full flex-col items-center justify-center gap-[6px] bg-surface-subtle text-[oklch(0.6_0.02_264)]"
            >
              <ImageOff className="size-5" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em]">no photo</span>
            </div>
          )}
        </div>
        {showCaption ? (
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
            {caption ? (
              typeof caption === 'string' ? (
                <span className="truncate font-mono text-[11px] text-ink-body">{caption}</span>
              ) : (
                <div className="min-w-0 flex-1">{caption}</div>
              )
            ) : (
              <span />
            )}
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
        ) : null}
      </div>
    )
  }
)
ImageTile.displayName = 'ImageTile'

export { ImageTile }
