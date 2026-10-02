import Link from 'next/link'
import { ChevronsUpDown } from 'lucide-react'
import { MicroLabel, cn } from '@repo/ui'

export function WorkspaceBrandLink({ name, collapsed }: { name?: string; collapsed: boolean }) {
  return (
    <Link
      href="/workspaces"
      className={cn(
        'flex min-w-0 items-center rounded-[10px] text-foreground transition-colors duration-200',
        collapsed ? 'justify-center' : 'flex-1 gap-2.5 px-2 py-1.5 hover:bg-card',
      )}
    >
      <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary-strong font-display text-[15px] font-semibold text-primary-strong-foreground">
        {name?.[0]?.toUpperCase() ?? 'W'}
      </span>
      {!collapsed ? (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-display text-[15px] font-semibold tracking-[-0.02em]">{name ?? 'Workspace'}</span>
            <MicroLabel as="span" className="tracking-[0.12em]">
              Switch workspace
            </MicroLabel>
          </span>
          <ChevronsUpDown className="size-[15px] shrink-0 text-ink-muted" aria-hidden="true" />
        </>
      ) : null}
    </Link>
  )
}
