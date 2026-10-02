'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MicroLabel, useToast } from '@repo/ui'
// [support-surfaces-off] was: import { MessageSquareText } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
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
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 sm:px-10">
        <BrandMark decorative className="size-7" />
        <span className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">Optra</span>
      </header>
      <main className="mx-auto max-w-[1040px] px-5 py-16 sm:px-10">
        {/* [support-surfaces-off] was: icon MessageSquareText, title "Opening workspace chat" */}
        <div className="relative overflow-hidden rounded-[18px] border border-border-panel bg-card p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-[34%] animate-[rf-sweep_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite] bg-[linear-gradient(90deg,transparent,oklch(0.5_0.09_184/0.12),transparent)]"
          />
          <MicroLabel as="p" tone="teal">
            Redirecting…
          </MicroLabel>
          <h3 className="mt-3 text-xl">Opening your workspace</h3>
          <p className="mt-2 text-[15px] leading-[1.6] text-ink-body">
            Picking your first available workspace and redirecting you there.
          </p>
        </div>
      </main>
    </div>
  )
}
