'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell, Badge, Button, Card, EmptyState, PageSection, useToast } from '@repo/ui'
import { CircleAlert, Database, FileText, Globe, MessageSquareText, Settings, Ticket, Users } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { listEvents, markEventsSeen } from '@/lib/api/events'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { WorkspaceNav } from '@/components/workspace-nav'

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
  type: 'document_ingested' | 'document_failed' | 'scrape_completed' | 'scrape_failed' | 'ticket_extracted' | 'ticket_failed'
  title: string
  detail: string | null
  createdAt: string
}

type EventListResponse = {
  items: WorkspaceEvent[]
  nextCursor: string | null
}

const quickLinks = (workspaceId: string) => [
  {
    label: 'Knowledge Bases',
    href: `/workspaces/${workspaceId}/knowledge-bases`,
    description: 'Manage the sources your assistant retrieves from.',
    icon: <Database className="size-5" />,
  },
  {
    label: 'Members',
    href: `/workspaces/${workspaceId}/members`,
    description: 'Invite teammates and manage roster access.',
    icon: <Users className="size-5" />,
  },
  {
    label: 'Chat',
    href: `/workspaces/${workspaceId}/chat`,
    description: 'Ask grounded questions against this workspace.',
    icon: <MessageSquareText className="size-5" />,
  },
  {
    label: 'Tickets',
    href: `/workspaces/${workspaceId}/tickets`,
    description: 'Draft and review tickets from support calls.',
    icon: <Ticket className="size-5" />,
  },
  {
    label: 'Settings',
    href: `/workspaces/${workspaceId}/settings`,
    description: 'Workspace-level configuration.',
    icon: <Settings className="size-5" />,
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
  const hasMarkedSeenRef = React.useRef(false)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const loadPage = React.useCallback(async () => {
    try {
      const [workspaceData, memberships, eventData] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaces(),
        listEvents(workspaceId) as Promise<EventListResponse>,
      ])
      setWorkspace(workspaceData)
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
      setEvents(Array.isArray(eventData?.items) ? eventData.items : [])
      setEventsNextCursor(eventData?.nextCursor ?? null)

      if (!hasMarkedSeenRef.current) {
        hasMarkedSeenRef.current = true
        void markEventsSeen(workspaceId)
      }
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
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

  const eventIcon = React.useCallback((type: WorkspaceEvent['type']) => {
    switch (type) {
      case 'document_ingested':
      case 'document_failed':
        return <FileText className="size-4" />
      case 'scrape_completed':
      case 'scrape_failed':
        return <Globe className="size-4" />
      case 'ticket_extracted':
      case 'ticket_failed':
        return <Ticket className="size-4" />
      default:
        return <CircleAlert className="size-4" />
    }
  }, [])

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
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            {workspace?.name?.[0]?.toUpperCase() ?? 'W'}
          </span>
          {!collapsed ? <span className="truncate">{workspace?.name ?? 'Workspace'}</span> : null}
        </Link>
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      title={workspace?.name ?? 'Workspace'}
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        <PageSection eyebrow={<Badge variant="outline">Workspace</Badge>} title="Where to next" description="Jump into any area of this workspace.">
          <div className="grid gap-4 md:grid-cols-2">
            {quickLinks(workspaceId).map((link) => (
              <Link key={link.href} href={link.href}>
                <Card variant="elevated" className="flex items-start gap-4 p-6 transition-colors hover:bg-card/80">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent/20 text-accent-foreground">{link.icon}</span>
                  <div>
                    <h3 className="text-lg font-semibold">{link.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </PageSection>

        <PageSection eyebrow={<Badge variant="outline">Activity</Badge>} title="Activity" description="Document imports, crawls, and ticket extractions in this workspace.">
          {events.length === 0 ? (
            <EmptyState
              icon={<CircleAlert className="size-5" />}
              title="No activity yet"
              description="Document imports, crawls, and ticket extractions will show up here."
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                {events.map((event) => (
                  <Card key={event.id} variant="elevated" className="flex items-start gap-4 p-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                      {eventIcon(event.type)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <h3 className="font-medium">{event.title}</h3>
                        <span className="text-sm text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {event.detail ? <p className="text-sm text-muted-foreground">{event.detail}</p> : null}
                    </div>
                  </Card>
                ))}
              </div>

              {eventsNextCursor ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
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
    </AppShell>
  )
}
