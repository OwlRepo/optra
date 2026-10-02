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

// Storyboard 01 C09: a table footer, not a toolbar. Docks to the bottom of
// its table panel (pass it as <Table footer={...}>) on the subtle fill.
const pageButtonClassName = 'size-8 rounded-[9px] [&_svg]:size-[15px]'

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
        'flex flex-wrap items-center justify-between gap-3 border-t border-border-inner bg-surface-subtle px-[18px] py-3',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12px] text-ink-body">
          {rangeStart}–{rangeEnd} of {total}
        </span>
        {onPageSizeChange ? (
          <label className="flex items-center">
            <span className="sr-only">Rows per page</span>
            <Select
              aria-label="Rows per page"
              className="h-8 w-auto rounded-[9px] pl-[10px] pr-[30px] font-mono text-[12px] [--chevron-right:9px] [--chevron-size:14px]"
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

      <div className="flex items-center gap-[6px]">
        <span className="mr-[6px] whitespace-nowrap font-mono text-[12px] text-ink-body">
          Page {Math.min(page, effectivePages)} of {effectivePages}
        </span>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={pageButtonClassName}
          aria-label="First page"
          disabled={atFirst || isLoading}
          onClick={() => go(1)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={pageButtonClassName}
          aria-label="Previous page"
          disabled={atFirst || isLoading}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft />
        </Button>

        <form onSubmit={submitJump} className="flex items-center">
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
            className="h-8 w-12 rounded-[9px] border border-border-panel bg-card text-center font-mono text-[12px] text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-ink-muted focus-visible:border-primary-strong focus-visible:shadow-focus disabled:opacity-45"
          />
        </form>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={pageButtonClassName}
          aria-label="Next page"
          disabled={atLast || isLoading}
          onClick={() => go(page + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={pageButtonClassName}
          aria-label="Last page"
          disabled={atLast || isLoading}
          onClick={() => go(effectivePages)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </nav>
  )
}
