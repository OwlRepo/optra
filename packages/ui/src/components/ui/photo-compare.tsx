import * as React from 'react'
import { cn } from '../../lib/utils'
import { Badge } from './badge'
import { ConfidenceMeter } from './confidence-meter'
import { ImageTile } from './image-tile'
import { MicroLabel } from './page-section'

export interface PhotoCompareQuery {
  sku?: string | null
  description?: string | null
}

export interface PhotoCompareCandidate {
  sku?: string | null
  description?: string | null
  /** A resolved URL, NOT a raw storage key. */
  photoSrc?: string | null
  vendorName?: string
}

export interface PhotoCompareVerdict {
  score: number | null
  isMatch: boolean
  reason: string
}

export interface PhotoCompareProps extends React.HTMLAttributes<HTMLDivElement> {
  query: PhotoCompareQuery
  candidate: PhotoCompareCandidate
  verdict: PhotoCompareVerdict
  /** Candidate image is still resolving. */
  isLoading?: boolean
  /** Top row inside the panel (frame 2.11: type + status chips left, Dismiss right). */
  header?: React.ReactNode
}

// Storyboard 01 C18: one panel, two cells (Requested | candidate with a 112px
// 4:3 photo bordered in the verdict tone), then the "Catalog evidence" footer:
// solid verdict pill, reason sentence, 220px compact confidence bar.
const PhotoCompare = React.forwardRef<HTMLDivElement, PhotoCompareProps>(
  ({ query, candidate, verdict, isLoading, header, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('overflow-hidden rounded-[18px] border border-border-panel bg-card', className)}
        {...props}
      >
        {header ? (
          <div
            data-photo-compare-header
            className="flex items-center justify-between gap-3 border-b border-border-inner px-5 py-3"
          >
            {header}
          </div>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div
            data-testid="photo-compare-query-panel"
            className="border-b border-border-inner px-6 py-[22px] sm:border-b-0 sm:border-r"
          >
            <MicroLabel>Requested</MicroLabel>
            {query.sku ? <p className="mt-[14px] font-mono text-[14px] font-medium">{query.sku}</p> : null}
            {query.description ? (
              <p className="mt-[6px] text-[15px] leading-[1.6] text-ink-body">{query.description}</p>
            ) : null}
          </div>

          <div
            data-testid="photo-compare-candidate-panel"
            className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4 px-6 py-[22px]"
          >
            <ImageTile
              src={candidate.photoSrc}
              alt={candidate.sku ?? candidate.description ?? 'Candidate item'}
              aspect="photo"
              isLoading={isLoading}
              className={
                verdict.isMatch
                  ? '[&_[data-image-frame]]:border-primary-strong'
                  : '[&_[data-image-frame]]:border-destructive-tone'
              }
            />
            <div className="min-w-0">
              <MicroLabel>{candidate.vendorName ?? 'Candidate'}</MicroLabel>
              {candidate.sku ? <p className="mt-[10px] font-mono text-[14px] font-medium">{candidate.sku}</p> : null}
              {candidate.description ? (
                <p className="mt-[6px] text-[15px] leading-[1.6] text-ink-body">{candidate.description}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-6 border-t border-border-inner bg-surface-subtle px-6 pb-5 pt-[18px] sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex items-start gap-3">
            <Badge variant={verdict.isMatch ? 'solid-teal' : 'solid-red'} className="shrink-0">
              {verdict.isMatch ? 'Match' : 'No match'}
            </Badge>
            <p className="text-[14px] leading-[1.6] text-[oklch(0.36_0.02_264)]">{verdict.reason}</p>
          </div>
          {verdict.score !== null ? <ConfidenceMeter value={verdict.score} size="sm" /> : null}
        </div>
      </div>
    )
  }
)
PhotoCompare.displayName = 'PhotoCompare'

export { PhotoCompare }
