import * as React from 'react'
import { cn } from '../../lib/utils'

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Rendered inside the panel above the scroller (e.g. a PanelHeader or filter row). */
  header?: React.ReactNode
  /** Rendered inside the panel below the scroller (e.g. Pagination). */
  footer?: React.ReactNode
  /** Classes for the outer panel. `className` still targets the <table>. */
  containerClassName?: string
}

// Storyboard 01 C08: the table IS the panel (r18 hairline, white, overflow
// hidden). The overflow-x-auto scroller is the sanctioned mobile pattern.
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, header, footer, containerClassName, ...props }, ref) => (
    <div className={cn('w-full overflow-hidden rounded-[18px] border border-border-panel bg-card', containerClassName)}>
      {header}
      <div className="w-full overflow-x-auto">
        <table ref={ref} className={cn('w-full caption-bottom border-collapse text-[14px]', className)} {...props} />
      </div>
      {footer}
    </div>
  ),
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('bg-secondary [&_tr]:border-t-0 [&_tr]:hover:bg-transparent', className)}
      {...props}
    />
  ),
)
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn(className)} {...props} />
  ),
)
TableBody.displayName = 'TableBody'

export type TableRowTone = 'teal' | 'amber' | 'red' | 'neutral'

// The hero demo's 3px inset tone rule (flagged / selected rows).
const rowToneClassName: Record<TableRowTone, string> = {
  teal: 'inset-shadow-[3px_0_0_var(--primary-strong)]',
  amber: 'inset-shadow-[3px_0_0_var(--flag)]',
  red: 'inset-shadow-[3px_0_0_var(--destructive-tone)]',
  neutral: 'inset-shadow-[3px_0_0_var(--border-dashed)]',
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  tone?: TableRowTone
  /** Dismissed / inactive row: ink at 60%. */
  muted?: boolean
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, tone, muted = false, ...props }, ref) => (
    <tr
      ref={ref}
      data-tone={tone}
      className={cn(
        'border-t border-border-inner transition-colors hover:bg-surface-hover',
        tone ? rowToneClassName[tone] : null,
        muted ? 'text-foreground/60' : null,
        className,
      )}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Amount column: right-aligned. */
  numeric?: boolean
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, numeric = false, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'px-[14px] py-3 text-left align-middle text-[13px] font-semibold text-ink-body first:pl-6',
        numeric ? 'text-right' : null,
        className,
      )}
      {...props}
    />
  ),
)
TableHead.displayName = 'TableHead'

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Amount cell: right-aligned JetBrains Mono 13. */
  numeric?: boolean
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric = false, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('px-[14px] py-[13px] align-middle first:pl-6', numeric ? 'text-right font-mono text-[13px]' : null, className)}
      {...props}
    />
  ),
)
TableCell.displayName = 'TableCell'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
