'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState, PageShell, useToast } from '@repo/ui'
import { MessageSquareText } from 'lucide-react'
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
          router.push(`/workspaces/${firstWorkspace.id}/chat`)
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
          title: 'Workspace chat unavailable',
          description: 'Open a workspace first, then start chat from there.',
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
      <EmptyState
        icon={<MessageSquareText className="size-5" />}
        title="Opening workspace chat"
        description="Picking your first available workspace and redirecting you there."
      />
    </PageShell>
  )
}
