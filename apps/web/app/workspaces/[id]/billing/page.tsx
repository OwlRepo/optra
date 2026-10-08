'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Minus, Plus } from 'lucide-react'
import { AppShell, Button, Card, DefinitionRow, Eyebrow, Skeleton, StatusBanner, useToast } from '@repo/ui'
import type { BillingPlan, BillingSummary } from '@repo/types'
import { getBilling, openPortal, startCheckout } from '@/lib/api/billing'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { useWorkspaceContext } from '@/components/workspace-context'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { BillingUsageMeters } from '@/components/billing-usage-meters'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TourReplayButton } from '@/components/tour/tour-replay-button'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'
import { logout } from '@/lib/api/auth'

const DAY_MS = 86_400_000
const MIN_SEATS = 1
const MAX_SEATS = 25
const POLL_INTERVAL_MS = 2000
const POLL_MAX_READS = 10

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysLeft(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS))
}

function quotaText(value: number | null): string {
  return value === null ? 'Unlimited' : `${value.toLocaleString('en-US')} a month`
}

function statusLine(summary: BillingSummary): string {
  const status = summary.subscriptionStatus
  if (status === 'cancelled') return `Cancelled: access until ${formatDate(summary.endsAt)}`
  if (status === 'past_due') return 'Past due: Lemon Squeezy is retrying the card'
  if (status === 'expired') return 'Expired'
  if (!status) return ''
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="py-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mb-4 mt-3 text-[22px]">{title}</h2>
      {children}
    </section>
  )
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-6 py-6" role="status" aria-busy="true">
      <span className="sr-only">Loading billing</span>
      <Skeleton data-slot="skeleton" className="h-[120px] w-full rounded-[18px]" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton data-slot="skeleton" className="h-[220px] rounded-[18px]" />
        <Skeleton data-slot="skeleton" className="h-[220px] rounded-[18px]" />
      </div>
    </div>
  )
}

export default function BillingPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const workspaceId = params.id
  const { workspace, membership, status: workspaceStatus } = useWorkspaceContext()
  const isOwner = membership?.role === 'owner'
  const knownNonOwner = membership !== null && !isOwner
  const checkoutSuccess = searchParams?.get('checkout') === 'success'

  const [summary, setSummary] = React.useState<BillingSummary | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const [denied, setDenied] = React.useState(false)
  const [seats, setSeats] = React.useState(MIN_SEATS)
  const [pendingAction, setPendingAction] = React.useState<'solo' | 'team' | 'portal' | null>(null)
  const [pollReads, setPollReads] = React.useState(0)
  const [retrying, setRetrying] = React.useState(false)
  const noteId = React.useId()
  const soloRef = React.useRef<HTMLButtonElement>(null)
  const teamRef = React.useRef<HTMLButtonElement>(null)
  const manageRef = React.useRef<HTMLButtonElement>(null)
  // Which control to refocus once a failed action re-enables it.
  const refocusRef = React.useRef<'solo' | 'team' | 'portal' | null>(null)
  const requestRef = React.useRef(0)
  // useRouter() may hand back a new object per render; keep load() stable.
  const routerRef = React.useRef(router)
  routerRef.current = router

  const load = React.useCallback(
    async (silent = false): Promise<BillingSummary | null> => {
      const request = ++requestRef.current
      try {
        const data = await getBilling(workspaceId)
        if (request !== requestRef.current) return null
        setSummary(data)
        setLoadError(false)
        return data
      } catch (err) {
        if (request !== requestRef.current) return null
        if (isUnauthorized(err)) {
          routerRef.current.push('/login')
          return null
        }
        if (isForbidden(err)) {
          setDenied(true)
          return null
        }
        // A background re-read must not replace a good page with an error.
        if (!silent) setLoadError(true)
        return null
      }
    },
    [workspaceId],
  )

  React.useEffect(() => {
    void load()
  }, [load])

  // The checkout redirect can beat the webhook: re-read every 2 s, at most 10
  // times, until the summary says subscribed. One chain per page visit, driven
  // by refs so it does not depend on a render between reads.
  const hasSummary = summary !== null
  const alreadySubscribed = summary?.state === 'subscribed'
  React.useEffect(() => {
    if (!checkoutSuccess || !hasSummary || alreadySubscribed) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let reads = 0

    const tick = () => {
      timer = setTimeout(() => {
        void load(true).then((data) => {
          if (cancelled) return
          reads += 1
          setPollReads(reads)
          if (data?.state === 'subscribed' || reads >= POLL_MAX_READS) return
          tick()
        })
      }, POLL_INTERVAL_MS)
    }
    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [checkoutSuccess, hasSummary, alreadySubscribed, load])

  React.useEffect(() => {
    if (pendingAction !== null || refocusRef.current === null) return
    const target = { solo: soloRef, team: teamRef, portal: manageRef }[refocusRef.current]
    refocusRef.current = null
    target.current?.focus()
  }, [pendingAction])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const goTo = (url: string) => window.location.assign(url)

  const subscribe = async (plan: BillingPlan) => {
    setPendingAction(plan)
    try {
      const { url } = await startCheckout(workspaceId, plan === 'team' ? { plan, seats } : { plan })
      goTo(url)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      if ((err as { statusCode?: number } | null)?.statusCode === 409) {
        toast({ variant: 'error', title: 'This workspace already has a subscription', description: 'Use Manage billing to change it.' })
        void load()
      } else {
        toast({ variant: 'error', title: "Couldn't reach billing. Try again in a moment." })
      }
      refocusRef.current = plan
      setPendingAction(null)
    }
  }

  const manage = async () => {
    setPendingAction('portal')
    try {
      const { url } = await openPortal(workspaceId)
      goTo(url)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({ variant: 'error', title: "Couldn't reach billing. Try again in a moment." })
      refocusRef.current = 'portal'
      setPendingAction(null)
    }
  }

  const retry = () => {
    if (retrying) return
    setRetrying(true)
    void load().finally(() => setRetrying(false))
  }

  const gaveUp = pollReads >= POLL_MAX_READS
  const accessDenied = denied || workspaceStatus === 'denied'

  const renderPlans = () => (
    <Section eyebrow="Plans" title="Choose a plan">
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          variant="panel"
          role="group"
          aria-label="Solo plan"
          aria-describedby={knownNonOwner ? noteId : undefined}
          className="flex flex-col gap-4 p-6"
        >
          <div>
            <h3 className="text-[18px]">Solo</h3>
            <p className="mt-1 text-[14px] text-ink-body">$29 per month, sized for 1 buyer</p>
          </div>
          {isOwner ? (
            <Button
              ref={soloRef}
              variant="outline"
              className="mt-auto"
              isLoading={pendingAction === 'solo'}
              loadingText="Opening checkout"
              disabled={pendingAction !== null}
              onClick={() => void subscribe('solo')}
            >
              Subscribe to Solo
            </Button>
          ) : null}
        </Card>
        <Card
          variant="panel"
          role="group"
          aria-label="Team plan"
          aria-describedby={knownNonOwner ? noteId : undefined}
          className="flex flex-col gap-4 p-6"
        >
          <div>
            <h3 className="text-[18px]">Team</h3>
            <p className="mt-1 text-[14px] text-ink-body">$69 per buyer per month</p>
          </div>
          {isOwner ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-medium">Buyers</span>
              <div role="group" aria-label="Number of buyers" className="inline-flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Decrease buyers"
                  aria-disabled={seats <= MIN_SEATS}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  onClick={() => setSeats((n) => Math.max(MIN_SEATS, n - 1))}
                >
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <span aria-live="polite" className="min-w-8 text-center font-mono text-[14px] tabular-nums">
                  {seats}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Increase buyers"
                  aria-disabled={seats >= MAX_SEATS}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  onClick={() => setSeats((n) => Math.min(MAX_SEATS, n + 1))}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
          {isOwner ? (
            <Button
              ref={teamRef}
              className="mt-auto"
              isLoading={pendingAction === 'team'}
              loadingText="Opening checkout"
              disabled={pendingAction !== null}
              onClick={() => void subscribe('team')}
            >
              Subscribe to Team
            </Button>
          ) : null}
        </Card>
      </div>
      {isOwner ? (
        <p className="mt-3 text-[13px] text-ink-muted">Subscribing now starts your paid plan immediately.</p>
      ) : null}
      {knownNonOwner ? (
        <p id={noteId} className="mt-3 text-[13px] text-ink-muted">
          Only the workspace owner can change billing.
        </p>
      ) : null}
    </Section>
  )

  const renderSummary = (s: BillingSummary) => {
    if (s.state === 'exempt') {
      return (
        <StatusBanner variant="info" title="This workspace is exempt from billing." className="mt-6" />
      )
    }

    if (s.state === 'trialing') {
      const days = daysLeft(s.trialEndsAt)
      return (
        <>
          <Section eyebrow="Status" title="Free trial">
            <Card variant="panel" className="p-6">
              <p className="font-display text-[26px] font-semibold tracking-[-0.03em]">
                {days === 1 ? '1 day left' : `${days} days left`}
              </p>
              {s.quotas ? (
                <p className="mt-2 text-[14px] text-ink-body">
                  {`Includes the Solo allowance: ${s.quotas.matchedLines ?? 0} matched lines and ${s.quotas.photoChecks ?? 0} photo checks a month`}
                </p>
              ) : null}
              <BillingUsageMeters summary={s} className="mt-5" />
            </Card>
          </Section>
          {renderPlans()}
        </>
      )
    }

    if (s.state === 'subscribed') {
      return (
        <Section eyebrow="Status" title={s.plan === 'team' ? 'Team plan' : 'Solo plan'}>
          <Card variant="panel" className="overflow-hidden">
            <DefinitionRow density="roomy" label="Status" value={statusLine(s)} />
            {s.plan === 'team' && s.seats ? <DefinitionRow density="roomy" label="Buyers" value={String(s.seats)} /> : null}
            {s.renewsAt && s.subscriptionStatus !== 'cancelled' ? (
              <DefinitionRow density="roomy" label="Renews" value={formatDate(s.renewsAt)} />
            ) : null}
            {s.quotas ? (
              <>
                <DefinitionRow density="roomy" label="Matched lines" value={quotaText(s.quotas.matchedLines)} />
                <DefinitionRow density="roomy" label="Photo checks" value={quotaText(s.quotas.photoChecks)} />
              </>
            ) : null}
            <BillingUsageMeters summary={s} className="border-t border-border-inner px-6 py-4" />
            {isOwner ? (
              <div className="flex justify-end border-t border-border-inner bg-surface-subtle px-6 py-3.5">
                <Button ref={manageRef} size="sm" isLoading={pendingAction === 'portal'} loadingText="Opening" onClick={() => void manage()}>
                  Manage billing
                </Button>
              </div>
            ) : null}
          </Card>
        </Section>
      )
    }

    return (
      <>
        <Section eyebrow="Status" title="No active plan">
          {s.enforced ? (
            <p className="text-[14px] text-ink-body">Work is paused until you choose a plan.</p>
          ) : (
            <p className="text-[14px] text-ink-body">Choose a plan below to keep matching orders.</p>
          )}
        </Section>
        {renderPlans()}
      </>
    )
  }

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      userFooter={({ collapsed }) => <TourReplayButton collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={`${workspace?.name ?? 'Workspace'} / Workspace`}
      title="Billing"
      description="Your plan, trial and allowance."
      onLogout={handleLogout}
    >
      <div className="-mt-6 flex flex-col">
        {accessDenied ? (
          <WorkspaceAccessDenied />
        ) : loadError ? (
          <div className="py-6">
            <StatusBanner
              variant="error"
              title="Couldn't load billing."
              action={
                <Button size="sm" variant="outline" aria-disabled={retrying} onClick={retry}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : !summary ? (
          <BillingSkeleton />
        ) : (
          <>
            {checkoutSuccess ? (
              // One node for the whole flow so screen readers announce each text change.
              <StatusBanner
                className="mt-6"
                variant={summary.state === 'subscribed' ? 'success' : gaveUp ? 'warning' : 'loading'}
                title={
                  summary.state === 'subscribed'
                    ? 'Your plan is active.'
                    : gaveUp
                      ? 'This is taking longer than usual. Refresh in a minute.'
                      : 'Payment received. Activating your plan…'
                }
              />
            ) : null}
            {renderSummary(summary)}
            {knownNonOwner && summary.state === 'subscribed' ? (
              <p className="pb-6 text-[13px] text-ink-muted">Only the workspace owner can change billing.</p>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  )
}
