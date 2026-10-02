'use client'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, Eyebrow, useToast } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'
import { acceptInvite } from '@/lib/api/workspaces'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'

export default function InvitePage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleAccept = React.useCallback(async () => {
    try {
      setError(null)
      setIsSubmitting(true)
      const workspace = await acceptInvite(params.token)
      toast({
        variant: 'success',
        title: 'Workspace joined',
        description: `You now have access to ${workspace.name}.`,
      })
      // [support-surfaces-off] was: router.push(`/workspaces/${workspace.id}/chat`)
      router.push(`/workspaces/${workspace.id}/procurement`)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }

      const message =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Unable to accept invite.'

      setError(message)
      toast({
        variant: 'error',
        title: 'Invite could not be accepted',
        description: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [params.token, router, toast])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1040px] items-center gap-2.5 px-5 py-3.5 sm:px-10">
          <BrandMark decorative className="size-7" />
          <span className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">Optra</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1040px] px-5 py-[72px] sm:px-10">
        <div className="grid items-center gap-12 rounded-[24px] bg-cta-surface p-8 text-cta-surface-foreground sm:p-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <Eyebrow className="text-cta-surface-accent">Invitation</Eyebrow>
            <h1 className="mt-4 text-[44px] leading-[1.05]">Join workspace?</h1>
            <p className="mt-4 max-w-[44ch] text-[17px] leading-[1.7] text-cta-surface-muted">
              {/* [support-surfaces-off] was: Accept the invitation to join the shared workspace and access its knowledge bases and documents. */}
              Accept the invitation to join the shared workspace and see its vendors, documents and discrepancy history.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => void handleAccept()}
              isLoading={isSubmitting}
              loadingText="Joining"
              className="h-auto justify-between rounded-[14px] bg-cta-surface-foreground px-6 py-[18px] text-base font-semibold text-[oklch(0.28_0.04_200)] hover:bg-card"
            >
              Join workspace <span aria-hidden="true">→</span>
            </Button>
            <p className="mt-1 text-[13px] leading-[1.6] text-[oklch(0.8_0.02_200)]">
              {"You'll land on the workspace's Purchase Orders."}
            </p>
            {error ? (
              <p className="mt-2 rounded-[10px] bg-destructive-tone/18 px-3.5 py-2.5 text-[13px] leading-[1.5] text-[oklch(0.95_0.03_27)]">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
