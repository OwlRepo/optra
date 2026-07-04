'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from './button'
import { Select } from './select'
import { cn } from '../../lib/utils'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  isLoading?: boolean
  className?: string
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20, 50],
  isLoading = false,
  className,
}: PaginationProps) {
  const effectivePages = Math.max(totalPages, 1)
  const [jump, setJump] = React.useState('')

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = total === 0 ? 0 : Math.min(page * pageSize, total)

  const atFirst = page <= 1
  const atLast = page >= effectivePages || total === 0

  const go = (next: number) => {
    const clamped = Math.min(Math.max(Math.trunc(next), 1), effectivePages)
    if (!Number.isFinite(clamped)) return
    onPageChange(clamped)
  }

  const submitJump = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = Number(jump)
    if (!jump.trim() || !Number.isFinite(parsed)) return
    go(parsed)
    setJump('')
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col gap-3 border-t border-border/60 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>
          {rangeStart}–{rangeEnd} of {total}
        </span>
        {onPageSizeChange ? (
          <label className="flex items-center gap-2">
            <span className="sr-only">Rows per page</span>
            <Select
              aria-label="Rows per page"
              className="h-9 w-auto rounded-xl px-3 text-xs"
              value={pageSize}
              disabled={isLoading}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <span className="mr-1 whitespace-nowrap text-muted-foreground">
          Page {Math.min(page, effectivePages)} of {effectivePages}
        </span>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="First page"
          disabled={atFirst || isLoading}
          onClick={() => go(1)}
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={atFirst || isLoading}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <form onSubmit={submitJump} className="flex items-center gap-1">
          <label htmlFor="pagination-goto" className="sr-only">
            Go to page
          </label>
          <input
            id="pagination-goto"
            aria-label="Go to page"
            inputMode="numeric"
            pattern="\d*"
            value={jump}
            disabled={isLoading}
            onChange={(event) => setJump(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="Go"
            className="h-9 w-14 rounded-xl border border-input bg-background/90 px-2 text-center text-xs shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60"
          />
        </form>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={atLast || isLoading}
          onClick={() => go(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Last page"
          disabled={atLast || isLoading}
          onClick={() => go(effectivePages)}
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </nav>
  )
}
