import { X } from 'lucide-react'
import { cn } from '@repo/ui'

export interface ScopeChipProps {
  /** What the list is scoped to, in Mono: "PO-… ↔ INV-…" (2.7) or "PO line · SKU" (2.11). */
  label: string
  /** Accessible name of the × button. */
  clearLabel: string
  /** Drops the scope. Callers `router.replace` without the scoping query params. */
  onClear: () => void
  className?: string
}

/**
 * Names a scope that query params silently apply to a list, with a × that
 * drops it (frames 2.7 and 2.11). One component for both, so the pair chip and
 * the line chip cannot drift apart.
 */
export function ScopeChip({ label, clearLabel, onClear, className }: ScopeChipProps) {
  return (
    <div
      className={cn(
        'inline-flex h-[34px] max-w-full items-center gap-2 whitespace-nowrap rounded-[10px] border border-primary-strong/35 bg-primary-strong/6 pl-3 pr-[6px] font-mono text-[12px] text-[oklch(0.36_0.02_264)]',
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        aria-label={clearLabel}
        onClick={onClear}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-ink-ghost transition-colors duration-200 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
      >
        <X className="size-[13px]" aria-hidden="true" />
      </button>
    </div>
  )
}
