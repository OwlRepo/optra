'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell, Badge, Button, EmptyState, Eyebrow, HistoryRow, PageSection, useToast } from '@repo/ui'
import { logout } from '@/lib/api/auth'
import { getUnreadCount, listEvents, markEventsSeen } from '@/lib/api/events'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { getWorkspace } from '@/lib/api/workspaces'
import { membershipFrom } from '@/lib/workspace-role'
import { formatDateTime } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = {
  id: string
  name: string
}

type WorkspaceMembership = {
  id: string
  role: 'owner' | 'admin' | 'member'
}

type WorkspaceEvent = {
  id: string
  // Hand-duplicated from `workspace_event_type` — the API's shape does not
  // reach this file as a type. It must be widened in the same change as the
  // enum; `eventTone` below is keyed by this union, so a missing tone is a
  // compile error rather than a silently neutral row.
  type:
    | 'document_ingested'
    | 'document_failed'
    | 'scrape_completed'
    | 'scrape_failed'
    | 'ticket_extracted'
    | 'ticket_failed'
    | 'comparison_flagged'
    | 'comparison_failed'
  title: string
  detail: string | null
  createdAt: string
}

type EventListResponse = {
  items: WorkspaceEvent[]
  nextCursor: string | null
}

type UnreadCountResponse = {
  count: number
}

type HistoryTone = React.ComponentProps<typeof HistoryRow>['tone']

// Storyboard C19: *_failed red, comparison_flagged amber, ingested/completed
// teal, extracted neutral.
const eventTone: Record<WorkspaceEvent['type'], HistoryTone> = {
  document_ingested: 'teal',
  document_failed: 'red',
  scrape_completed: 'teal',
  scrape_failed: 'red',
  ticket_extracted: 'neutral',
  ticket_failed: 'red',
  comparison_flagged: 'amber',
  comparison_failed: 'red',
}

// An event type the API adds before this file is widened still renders, in
// the neutral tone.
function toneFor(type: string): HistoryTone {
  return (eventTone as Record<string, HistoryTone | undefined>)[type] ?? 'neutral'
}

const roleLabel: Record<WorkspaceMembership['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

const quickLinks = (workspaceId: string) => [
  // [support-surfaces-off] Knowledge Bases quick link:
  // {
  //   label: 'Knowledge Bases',
  //   href: `/workspaces/${workspaceId}/knowledge-bases`,
  //   description: 'Manage the sources your assistant retrieves from.',
  // },
  {
    label: 'Members',
    href: `/workspaces/${workspaceId}/members`,
    description: 'Invite teammates and manage roster access.',
  },
  // [support-surfaces-off] Chat quick link:
  // {
  //   label: 'Chat',
  //   href: `/workspaces/${workspaceId}/chat`,
  //   description: 'Ask grounded questions against this workspace.',
  // },
  // [support-surfaces-off] Tickets quick link:
  // {
  //   label: 'Tickets',
  //   href: `/workspaces/${workspaceId}/tickets`,
  //   description: 'Draft and review tickets from support calls.',
  // },
  {
    label: 'Settings',
    href: `/workspaces/${workspaceId}/settings`,
    description: 'Workspace-level configuration.',
  },
]

export default function WorkspaceOverviewPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const workspaceId = params.id
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [events, setEvents] = React.useState<WorkspaceEvent[]>([])
  const [eventsNextCursor, setEventsNextCursor] = React.useState<string | null>(null)
  const [isLoadingMoreEvents, setIsLoadingMoreEvents] = React.useState(false)
  const [unseenCount, setUnseenCount] = React.useState(0)
  const hasMarkedSeenRef = React.useRef(false)
  // B18. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty content.
  const [accessDenied, setAccessDenied] = React.useState(false)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const loadPage = React.useCallback(async () => {
    try {
      const [workspaceData, eventData, unread] = await Promise.all([
        getWorkspace(workspaceId),
        listEvents(workspaceId) as Promise<EventListResponse>,
        // Read here, before markEventsSeen below moves the server's marker, so
        // "N new since your last visit" and the tinted rows describe this
        // visit. WorkspaceNav's own read races markEventsSeen; this one cannot.
        // A failed read costs only the hint, never the page.
        (getUnreadCount(workspaceId) as Promise<UnreadCountResponse>).catch(() => null),
      ])
      setWorkspace(workspaceData)
      setMembership(membershipFrom(workspaceData))
      setEvents(Array.isArray(eventData?.items) ? eventData.items : [])
      setEventsNextCursor(eventData?.nextCursor ?? null)
      setUnseenCount(typeof unread?.count === 'number' ? unread.count : 0)

      if (!hasMarkedSeenRef.current) {
        hasMarkedSeenRef.current = true
        void markEventsSeen(workspaceId)
      }
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      if (isForbidden(err)) {
        setAccessDenied(true)
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load workspace',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    void loadPage()
  }, [loadPage])

  const loadMoreEvents = React.useCallback(async () => {
    if (!eventsNextCursor) return

    try {
      setIsLoadingMoreEvents(true)
      const data = (await listEvents(workspaceId, { cursor: eventsNextCursor })) as EventListResponse
      setEvents((current) => [...current, ...(Array.isArray(data?.items) ? data.items : [])])
      setEventsNextCursor(data?.nextCursor ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      toastRef.current({
        variant: 'error',
        title: 'Failed to load more activity',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      })
    } finally {
      setIsLoadingMoreEvents(false)
    }
  }, [eventsNextCursor, router, workspaceId])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb="Workspace / Overview"
      title={workspace?.name ?? 'Workspace'}
      badge={membership ? <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge> : null}
      onLogout={handleLogout}
    >
      <div className="flex flex-col gap-10">
        {accessDenied ? (
          <WorkspaceAccessDenied />
        ) : (
          <>
            <PageSection eyebrow={<Eyebrow>Workspace</Eyebrow>} title="Where to next" description="Jump into any area of this workspace.">
              <div className="grid gap-4 md:grid-cols-2">
                {quickLinks(workspaceId).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-end justify-between gap-4 rounded-[16px] border border-border-panel bg-card p-[22px] text-foreground transition-colors duration-200 hover:border-primary-strong/50"
                  >
                    <div>
                      <h3 className="text-[17px]">{link.label}</h3>
                      <p className="mt-1.5 text-[14px] leading-[1.6] text-[oklch(0.48_0.02_264)]">{link.description}</p>
                    </div>
                    <span aria-hidden="true" className="text-primary-strong">
                      →
                    </span>
                  </Link>
                ))}
              </div>
            </PageSection>

            <div {...tourAttr(TOUR_ANCHORS.overviewActivity)}>
              <PageSection
                eyebrow={<Eyebrow>Activity</Eyebrow>}
                title="Activity"
                description="What this workspace has done on its own — imports, crawls, extractions and comparisons."
                descriptionClassName="max-w-[60ch]"
                actions={
                  unseenCount > 0 ? (
                    <span className="font-mono text-[11px] text-primary-strong-hover">{`${unseenCount} new since your last visit`}</span>
                  ) : undefined
                }
              >
                {events.length === 0 ? (
                  <EmptyState
                    label="Quiet so far"
                    labelTone="teal"
                    title="No activity yet"
                    description="Work this workspace does on its own will show up here."
                  />
                ) : (
                  <div className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
                    <ol className="flex flex-col gap-1.5 p-4">
                      {events.map((event, index) => (
                        <li key={event.id}>
                          {/* Events arrive newest first and the unread count is every
                              event newer than the last visit, so the first
                              `unseenCount` rows are exactly the unseen ones. */}
                          <HistoryRow
                            eventKey={event.type}
                            title={event.title}
                            detail={event.detail ?? undefined}
                            timestamp={formatDateTime(event.createdAt)}
                            tone={toneFor(event.type)}
                            unseen={index < unseenCount}
                          />
                        </li>
                      ))}
                    </ol>

                    {eventsNextCursor ? (
                      <div className="border-t border-border-inner bg-surface-subtle px-5 py-3.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadMoreEvents()}
                          isLoading={isLoadingMoreEvents}
                          loadingText="Loading"
                        >
                          {!isLoadingMoreEvents ? 'Load more' : null}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </PageSection>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
