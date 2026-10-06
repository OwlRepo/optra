import { isNotNull, or, eq } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

// One cap for both ends: a photo read that returns more lines than this cannot
// be saved back through the review form (ReviewDocumentDto), so the parse
// refuses it up front instead of leaving a document nobody can confirm.
export const MAX_REVIEW_LINES = 200

/**
 * Review gate (photo intake). A document is comparable when it never needed a
 * human review, or when a reviewer has confirmed it. Every compare path uses
 * this one predicate so the gate cannot be forgotten in a new place.
 */
export function reviewCleared(cols: { reviewRequired: AnyPgColumn; reviewedAt: AnyPgColumn }) {
  return or(eq(cols.reviewRequired, false), isNotNull(cols.reviewedAt))
}

/** In-memory twin of `reviewCleared`, for rows already loaded. */
export function isReviewPending(row: { reviewRequired: boolean; reviewedAt: Date | null }): boolean {
  return row.reviewRequired && row.reviewedAt === null
}
