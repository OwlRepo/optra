import * as React from 'react'
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from './button'
import { cn } from '../../lib/utils'

type CollapsibleSlot = (args: { collapsed: boolean }) => React.ReactNode

export function AppShell({
  sidebarHeader,
  navigation,
  userFooter,
  title,
  description,
  badge,
  actions,
  onLogout,
  children,
  className,
}: {
  sidebarHeader: CollapsibleSlot
  navigation: CollapsibleSlot
  userFooter?: CollapsibleSlot
  title?: string
  description?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  onLogout?: () => void | Promise<void>
  children: React.ReactNode
  className?: string
}) {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <div className={cn('flex min-h-screen', className)}>
      <aside
        className={cn(
          'flex shrink-0 flex-col justify-between border-r border-border/70 bg-secondary/60 py-4 transition-[width] duration-200 ease-out',
          collapsed ? 'w-16 px-2' : 'w-64 px-4',
        )}
      >
        <div className="space-y-6">
          <div className={cn('flex', collapsed && 'justify-center')}>{sidebarHeader({ collapsed })}</div>
          {navigation({ collapsed })}
        </div>
        <div className="space-y-3">
          {userFooter ? userFooter({ collapsed }) : null}
          <div className={cn('flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
            {onLogout ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Log out"
                onClick={() => {
                  const result = onLogout()
                  if (result && typeof result === 'object' && 'catch' in result && typeof result.catch === 'function') {
                    void result.catch(() => {})
                  }
                }}
              >
                <LogOut className="size-4" />
                {!collapsed ? 'Log out' : null}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {title || description || badge || actions ? (
          <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 px-6 py-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {title ? <div className="truncate text-xl font-semibold">{title}</div> : null}
                  {badge}
                </div>
                {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
              </div>
              {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
            </div>
          </header>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
