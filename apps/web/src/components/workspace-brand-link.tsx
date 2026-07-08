import Link from 'next/link'

export function WorkspaceBrandLink({ name, collapsed }: { name?: string; collapsed: boolean }) {
  return (
    <Link href="/workspaces" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        {name?.[0]?.toUpperCase() ?? 'W'}
      </span>
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{name ?? 'Workspace'}</span> : null}
    </Link>
  )
}
