import * as React from 'react'
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from './button'
import { MobileNavDrawer } from './mobile-nav-drawer'
import { cn } from '../../lib/utils'

type CollapsibleSlot = (args: { collapsed: boolean }) => React.ReactNode

export function AppShell({
  sidebarHeader,
  navigation,
  userFooter,
  mobileTabBar,
  mobileFullBleed,
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
  mobileTabBar?: (args: { moreActive: boolean; onMoreClick: () => void }) => React.ReactNode
  /** On mobile, hide the sticky title header and the tab bar/hamburger so content can use the
   * full screen — the caller renders its own compact header via the `children` function form
   * (receives `openMobileNav`) to still offer a way into the drawer. Desktop is unaffected. */
  mobileFullBleed?: boolean
  title?: string
  description?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  onLogout?: () => void | Promise<void>
  children: React.ReactNode | ((args: { openMobileNav: () => void }) => React.ReactNode)
  className?: string
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  return (
    <div className={cn('flex min-h-screen', className)}>
      <aside
        className={cn(
          'hidden shrink-0 flex-col justify-between border-r border-border/70 bg-secondary/60 py-4 transition-[width] duration-200 ease-out lg:flex',
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

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        sidebarHeader={sidebarHeader}
        navigation={navigation}
        userFooter={userFooter}
        onLogout={onLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {!mobileTabBar && !mobileFullBleed ? (
          <div className="flex items-center border-b border-border/70 bg-background/75 px-4 py-3 backdrop-blur-xl lg:hidden">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
          </div>
        ) : null}
        {title || description || badge || actions ? (
          <header
            className={cn(
              'sticky top-0 z-30 border-b border-border/70 bg-background/75 px-6 py-4 backdrop-blur-xl',
              mobileFullBleed && 'hidden lg:block',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  {title ? <div className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</div> : null}
                  {badge ? <div className="shrink-0">{badge}</div> : null}
                </div>
                {description ? <p className="truncate text-sm text-muted-foreground sm:whitespace-normal">{description}</p> : null}
              </div>
              {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
            </div>
          </header>
        ) : null}
        <main className={cn('min-w-0 flex-1', mobileTabBar && !mobileFullBleed && 'pb-20 lg:pb-0')}>
          {typeof children === 'function' ? children({ openMobileNav: () => setMobileNavOpen(true) }) : children}
        </main>
      </div>

      {mobileTabBar && !mobileFullBleed
        ? mobileTabBar({
            moreActive: mobileNavOpen,
            onMoreClick: () => setMobileNavOpen((current) => !current),
          })
        : null}
    </div>
  )
}
