'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button, cn } from '@repo/ui'
// [support-surfaces-off] was: import { BriefcaseBusiness, ClipboardList, Database, FileSpreadsheet, FileWarning, LineChart, MessageSquareText, PackageSearch, Settings, Store, Ticket, Users } from 'lucide-react'
import { BriefcaseBusiness, ClipboardList, Compass, FileWarning, PackageSearch, Settings, Store, Users } from 'lucide-react'
import { getUnreadCount } from '@/lib/api/events'
import { TOUR_ANCHORS, navAnchorFor, tourAttr } from './tour/tour-anchors'
import { useTour } from './tour/tour-provider'
// [support-surfaces-off] import { WorkspaceSearch } from './workspace-search'

export type WorkspaceNavGroup = 'matching' | 'workspace'

export interface WorkspaceNavItem {
  label: string
  href: string
  icon: React.ReactNode
  exact?: boolean
  group: WorkspaceNavGroup
}

const NAV_GROUPS: { id: WorkspaceNavGroup; label: string }[] = [
  { id: 'matching', label: 'Matching' },
  { id: 'workspace', label: 'Workspace' },
]

// Matching first, workspace admin last (AppSidebar.dc.html, frame 4.1).
// [support-surfaces-off] The hidden items below carry no `group`; each needs one
// on re-enable (a product decision) or the type check fails.
export function workspaceNavItems(workspaceId: string): WorkspaceNavItem[] {
  return [
    { label: 'Overview', href: `/workspaces/${workspaceId}`, icon: <BriefcaseBusiness className="size-4" />, exact: true, group: 'matching' },
    // [support-surfaces-off] { label: 'Knowledge Bases', href: `/workspaces/${workspaceId}/knowledge-bases`, icon: <Database className="size-4" /> },
    // [support-surfaces-off] { label: 'Datasets', href: `/workspaces/${workspaceId}/datasets`, icon: <FileSpreadsheet className="size-4" /> },
    { label: 'Purchase Orders', href: `/workspaces/${workspaceId}/procurement`, icon: <ClipboardList className="size-4" />, group: 'matching' },
    { label: 'Discrepancies', href: `/workspaces/${workspaceId}/discrepancies`, icon: <FileWarning className="size-4" />, group: 'matching' },
    { label: 'Catalog Matches', href: `/workspaces/${workspaceId}/catalog-matches`, icon: <PackageSearch className="size-4" />, group: 'matching' },
    { label: 'Vendors', href: `/workspaces/${workspaceId}/vendors`, icon: <Store className="size-4" />, group: 'matching' },
    { label: 'Members', href: `/workspaces/${workspaceId}/members`, icon: <Users className="size-4" />, group: 'workspace' },
    // [support-surfaces-off] { label: 'Chat', href: `/workspaces/${workspaceId}/chat`, icon: <MessageSquareText className="size-4" /> },
    // [support-surfaces-off] { label: 'Tickets', href: `/workspaces/${workspaceId}/tickets`, icon: <Ticket className="size-4" /> },
    // [support-surfaces-off] { label: 'Insights', href: `/workspaces/${workspaceId}/insights`, icon: <LineChart className="size-4" /> },
    { label: 'Settings', href: `/workspaces/${workspaceId}/settings`, icon: <Settings className="size-4" />, group: 'workspace' },
  ]
}

export function workspacePrimaryTabItems(workspaceId: string) {
  return [
    { href: `/workspaces/${workspaceId}`, label: 'Overview', icon: <BriefcaseBusiness className="size-5" />, exact: true },
    // [support-surfaces-off] { href: `/workspaces/${workspaceId}/chat`, label: 'Chat', icon: <MessageSquareText className="size-5" /> },
    // [support-surfaces-off] { href: `/workspaces/${workspaceId}/knowledge-bases`, label: 'Knowledge', icon: <Database className="size-5" /> },
    // [support-surfaces-off] Stand-in tabs while Chat and Knowledge are hidden; delete these two on re-enable.
    { href: `/workspaces/${workspaceId}/procurement`, label: 'Purchase Orders', icon: <ClipboardList className="size-5" /> },
    { href: `/workspaces/${workspaceId}/discrepancies`, label: 'Discrepancies', icon: <FileWarning className="size-5" /> },
  ]
}

export function WorkspaceNav({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  const pathname = usePathname()
  const [unreadCount, setUnreadCount] = React.useState(0)
  const labelIdPrefix = React.useId()

  React.useEffect(() => {
    void getUnreadCount(workspaceId)
      .then((response) => {
        setUnreadCount(typeof response?.count === 'number' ? response.count : 0)
      })
      .catch(() => {
        setUnreadCount(0)
      })
  }, [workspaceId])

  const items = workspaceNavItems(workspaceId)
  const tour = useTour()

  return (
    <nav className={cn('flex flex-col', collapsed ? 'items-center gap-1' : 'gap-[22px]')}>
      {/* [support-surfaces-off] Search only finds KB documents, tickets and chat history.
      <div data-testid="workspace-search-slot" className="mb-4">
        <WorkspaceSearch workspaceId={workspaceId} collapsed={collapsed} />
      </div>
      */}
      {NAV_GROUPS.map((group) => {
        const labelId = `${labelIdPrefix}-${group.id}`

        return (
          <div
            key={group.id}
            role="group"
            aria-labelledby={labelId}
            className={cn('flex flex-col', collapsed ? 'items-center gap-1' : 'gap-0.5')}
          >
            <span
              id={labelId}
              className={
                collapsed
                  ? 'sr-only'
                  : 'px-2.5 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[oklch(0.6_0.02_264)]'
              }
            >
              {group.label}
            </span>
            {items
              .filter((item) => item.group === group.id)
              .map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname?.startsWith(`${item.href}/`)
                const showUnread = item.label === 'Overview' && unreadCount > 0
                const anchor = navAnchorFor(item.href, workspaceId, 'nav')

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    {...(anchor ? tourAttr(anchor) : {})}
                    className={cn(
                      'rounded-[10px] transition-colors duration-200',
                      collapsed
                        ? 'inline-flex size-10 items-center justify-center'
                        : 'flex items-center gap-2.5 px-2.5 py-2 text-sm font-medium',
                      isActive
                        ? cn('bg-card shadow-nav', collapsed ? 'text-primary-strong' : 'text-foreground')
                        : 'text-ink-ghost hover:bg-card hover:text-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('inline-flex', isActive ? 'text-primary-strong' : !collapsed && 'text-ink-muted')}
                    >
                      {item.icon}
                    </span>
                    <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1'}>{item.label}</span>
                    {!collapsed && showUnread ? (
                      <span
                        data-nav-indicator="unread"
                        aria-hidden="true"
                        className="min-w-5 rounded-full bg-primary-strong px-[7px] py-0.5 text-center font-mono text-[11px] font-medium text-primary-strong-foreground"
                      >
                        {unreadCount}
                      </span>
                    ) : null}
                    {!collapsed && isActive && !showUnread ? (
                      <span
                        data-nav-indicator="dot"
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-primary-strong"
                      />
                    ) : null}
                  </Link>
                )
              })}
          </div>
        )
      })}
      {tour ? (
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          aria-label={collapsed ? 'Take the tour' : undefined}
          onClick={(event) => tour.startTour(event.currentTarget)}
          {...tourAttr(TOUR_ANCHORS.replay)}
          className={collapsed ? undefined : 'w-full justify-start gap-2.5 px-2.5 text-sm'}
        >
          <Compass aria-hidden="true" />
          {collapsed ? null : 'Take the tour'}
        </Button>
      ) : null}
    </nav>
  )
}
