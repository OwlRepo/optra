import * as React from 'react'
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from './button'
import { MobileNavDrawer } from './mobile-nav-drawer'
import { MicroLabel } from './page-section'
import { cn } from '../../lib/utils'

type CollapsibleSlot = (args: { collapsed: boolean }) => React.ReactNode

// The sidebar <-> tab-bar cutover (Tailwind `lg`). Header actions render in
// exactly one place: in the header at lg and up, as a full-width block at the
// top of <main> below it. Rendering both and hiding one with CSS would put two
// identical controls in the accessibility tree wherever CSS is absent (jsdom).
const DESKTOP_QUERY = '(min-width: 1024px)'

function desktopQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DESKTOP_QUERY)
}

function subscribeToDesktop(onChange: () => void): () => void {
  const query = desktopQuery()
  if (!query || typeof query.addEventListener !== 'function') return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getDesktopSnapshot(): boolean {
  const query = desktopQuery()
  return query ? query.matches : true
}

// Server render and hydration assume desktop; the client re-renders with the
// real viewport right after hydration.
function getServerDesktopSnapshot(): boolean {
  return true
}

function useIsDesktop(): boolean {
  return React.useSyncExternalStore(subscribeToDesktop, getDesktopSnapshot, getServerDesktopSnapshot)
}

function runLogout(onLogout: () => void | Promise<void>) {
  const result = onLogout()
  if (result && typeof result === 'object' && 'catch' in result && typeof result.catch === 'function') {
    void result.catch(() => {})
  }
}

export function AppShell({
  sidebarHeader,
  navigation,
  userFooter,
  mobileTabBar,
  mobileFullBleed,
  hideMobileActions,
  breadcrumb,
  mobileBreadcrumb,
  title,
  mobileTitle,
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
  /** Below lg, skip the full-width actions block at the top of <main> because the page renders
   * its own (Purchase Orders places it under its tabs, frame 4.2). Header actions at lg+ are unchanged. */
  hideMobileActions?: boolean
  /** Mono micro label above the title, e.g. "Kestrel Supply Co. / Matching". */
  breadcrumb?: React.ReactNode
  /** Below lg, a shorter breadcrumb (frame 4.2 shows only the workspace name). */
  mobileBreadcrumb?: React.ReactNode
  title?: string
  /** Below lg, a shorter title (frame 4.2: "Purchase orders"). */
  mobileTitle?: string
  description?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  onLogout?: () => void | Promise<void>
  children: React.ReactNode | ((args: { openMobileNav: () => void }) => React.ReactNode)
  className?: string
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  const isDesktop = useIsDesktop()
  const shownBreadcrumb = isDesktop ? breadcrumb : (mobileBreadcrumb ?? breadcrumb)
  const shownTitle = isDesktop ? title : (mobileTitle ?? title)

  const hasHeader = Boolean(breadcrumb || title || description || badge || actions)
  const showHeaderActions = Boolean(actions) && isDesktop
  const showMobileActions = Boolean(actions) && !isDesktop && !mobileFullBleed && !hideMobileActions

  return (
    <div className={cn('flex min-h-screen leading-[normal]', className)}>
      <aside
        className={cn(
          'hidden shrink-0 flex-col justify-between gap-6 border-r border-border bg-secondary pb-4 pt-[18px] transition-[width] duration-200 ease-out lg:flex',
          collapsed ? 'w-16 items-center px-0' : 'w-[248px] px-3.5',
        )}
      >
        <div className={cn('flex min-w-0 flex-col gap-[22px]', collapsed && 'items-center')}>
          <div className={cn('flex min-w-0 items-center gap-2', collapsed && 'justify-center')}>
            {sidebarHeader({ collapsed })}
          </div>
          {navigation({ collapsed })}
        </div>
        <div className={cn('flex flex-col gap-3', collapsed && 'items-center')}>
          {userFooter ? userFooter({ collapsed }) : null}
          <div
            className={cn(
              'flex items-center border-t border-border pt-3',
              collapsed ? 'w-10 flex-col gap-1' : 'justify-between gap-2',
            )}
          >
            {onLogout ? (
              <Button
                variant="ghost"
                size={collapsed ? 'icon' : 'sm'}
                aria-label="Log out"
                className={cn(
                  'text-ink-ghost hover:bg-card hover:text-foreground',
                  collapsed ? 'size-10 rounded-[10px]' : 'gap-2 px-2.5',
                )}
                onClick={() => runLogout(onLogout)}
              >
                <LogOut className="size-4" aria-hidden="true" />
                {!collapsed ? 'Log out' : null}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              className={cn('rounded-[10px] text-ink-ghost hover:bg-card hover:text-foreground', collapsed && 'size-10')}
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
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
          <div className="flex items-center border-b border-border bg-background/86 px-4 py-3 backdrop-blur-[16px] lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              className="rounded-[10px] text-ink-ghost"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {hasHeader ? (
          <header
            className={cn(
              'sticky top-0 z-30 border-b border-border bg-background/86 px-5 pb-3.5 pt-3 backdrop-blur-[16px] lg:px-10 lg:py-[18px]',
              mobileFullBleed && 'hidden lg:block',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                {shownBreadcrumb ? <MicroLabel as="p">{shownBreadcrumb}</MicroLabel> : null}
                {shownTitle || badge ? (
                  <div className={cn('flex min-w-0 items-center gap-2 lg:gap-2.5', shownBreadcrumb && 'mt-1.5')}>
                    {shownTitle ? (
                      <h1 className="min-w-0 truncate text-[22px] leading-[1.15] lg:text-[26px] lg:leading-[1.1]">{shownTitle}</h1>
                    ) : null}
                    {badge ? (
                      <div className="shrink-0 max-lg:[&>div]:px-2 max-lg:[&>div]:py-0.5 max-lg:[&>div]:text-[11px]">
                        {badge}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {description ? <p className="mt-1.5 hidden text-sm text-muted-foreground lg:block">{description}</p> : null}
              </div>
              {showHeaderActions ? <div className="flex shrink-0 items-center gap-2.5">{actions}</div> : null}
            </div>
          </header>
        ) : null}
        <main
          className={cn(
            'min-w-0 flex-1',
            !mobileFullBleed && 'px-4 pb-12 pt-4 lg:px-10 lg:pb-12 lg:pt-8',
            mobileTabBar && !mobileFullBleed && 'pb-[100px]',
          )}
        >
          {showMobileActions ? (
            <div className="mb-[14px] flex flex-col gap-2.5 [&>*]:h-[46px]! [&>*]:w-full! [&>*]:justify-between! [&>*]:rounded-[12px]! [&>*]:px-4! [&>*]:text-[15px]!">
              {actions}
            </div>
          ) : null}
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
