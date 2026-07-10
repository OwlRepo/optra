import * as React from 'react'
import { cn } from '../../lib/utils'
import { Badge } from './badge'
import { Card, CardContent, CardDescription, CardHeader } from './card'
import { ConfidenceMeter } from './confidence-meter'
import { ImageTile } from './image-tile'

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
}

const PhotoCompare = React.forwardRef<HTMLDivElement, PhotoCompareProps>(
  ({ query, candidate, verdict, isLoading, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('flex flex-col gap-4', className)} {...props}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card variant="subtle" data-testid="photo-compare-query-panel">
            <CardHeader>
              <CardDescription>Requested</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {query.sku ? <p className="font-mono text-sm font-medium">{query.sku}</p> : null}
              {query.description ? (
                <p className="text-sm text-muted-foreground">{query.description}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card variant="subtle" data-testid="photo-compare-candidate-panel">
            <CardHeader>
              <CardDescription>{candidate.vendorName ?? 'Candidate'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <ImageTile
                src={candidate.photoSrc}
                alt={candidate.sku ?? candidate.description ?? 'Candidate item'}
                aspect="photo"
                isLoading={isLoading}
              />
              <div className="space-y-1">
                {candidate.sku ? <p className="font-mono text-sm font-medium">{candidate.sku}</p> : null}
                {candidate.description ? (
                  <p className="text-sm text-muted-foreground">{candidate.description}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-secondary/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={verdict.isMatch ? 'success' : 'destructive'}>
              {verdict.isMatch ? 'Match' : 'No match'}
            </Badge>
            <p className="text-sm text-muted-foreground">{verdict.reason}</p>
          </div>
          {verdict.score !== null ? (
            <ConfidenceMeter value={verdict.score} size="sm" className="sm:w-40" />
          ) : null}
        </div>
      </div>
    )
  }
)
PhotoCompare.displayName = 'PhotoCompare'

export { PhotoCompare }
