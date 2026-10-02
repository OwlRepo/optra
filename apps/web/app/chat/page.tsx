'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState, PageShell, useToast } from '@repo/ui'
// [support-surfaces-off] was: import { MessageSquareText } from 'lucide-react'
import { ClipboardList } from 'lucide-react'
import { listWorkspaces } from '@/lib/api/workspaces'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'

export default function ChatRedirectPage() {
  const router = useRouter()
  const { toast } = useToast()

  React.useEffect(() => {
    let cancelled = false

    async function routeToWorkspaceChat() {
      try {
        const workspaces = await listWorkspaces()
        if (cancelled) return

        const items = Array.isArray(workspaces?.items) ? workspaces.items : []
        const firstWorkspace = items[0] ?? null
        if (firstWorkspace?.id) {
          // [support-surfaces-off] was: router.push(`/workspaces/${firstWorkspace.id}/chat`)
          router.push(`/workspaces/${firstWorkspace.id}/procurement`)
          return
        }

        router.push('/workspaces')
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }

        toast({
          variant: 'error',
          // [support-surfaces-off] was: title 'Workspace chat unavailable', description 'Open a workspace first, then start chat from there.'
          title: 'Workspace unavailable',
          description: 'Open a workspace from the list to continue.',
        })
        router.push('/workspaces')
      }
    }

    void routeToWorkspaceChat()

    return () => {
      cancelled = true
    }
  }, [router, toast])

  return (
    <PageShell contentClassName="flex min-h-screen items-center py-16">
      {/* [support-surfaces-off] was: icon MessageSquareText, title "Opening workspace chat" */}
      <EmptyState
        icon={<ClipboardList className="size-5" />}
        title="Opening your workspace"
        description="Picking your first available workspace and redirecting you there."
      />
    </PageShell>
  )
}
