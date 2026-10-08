'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { BillingSummary } from '@repo/types'
import { getBilling } from '@/lib/api/billing'

const DAY_MS = 86_400_000
const WARN_DAYS = 3

function bannerCopy(summary: BillingSummary): { title: string; action: string } | null {
  if (summary.state === 'trialing' && summary.trialEndsAt) {
    const days = Math.ceil((new Date(summary.trialEndsAt).getTime() - Date.now()) / DAY_MS)
    if (days > WARN_DAYS) return null
    const title =
      days <= 0 ? 'Your free trial ends today.' : days === 1 ? 'Your free trial ends in 1 day.' : `Your free trial ends in ${days} days.`
    return { title, action: 'View billing' }
  }
  if (summary.state === 'none' && summary.enforced) {
    return { title: 'No active plan. Choose a plan to keep matching orders.', action: 'Choose a plan' }
  }
  return null
}

// Advisory only: silent while loading and on any error (the Billing page owns
// the error state), so a billing outage never breaks a workspace page.
export function BillingBanner({ workspaceId }: { workspaceId: string }) {
  const [summary, setSummary] = React.useState<BillingSummary | null>(null)
  // Only the latest request may write state.
  const requestRef = React.useRef(0)

  React.useEffect(() => {
    const request = ++requestRef.current
    setSummary(null)
    getBilling(workspaceId)
      .then((data) => {
        if (request === requestRef.current) setSummary(data)
      })
      .catch(() => {
        if (request === requestRef.current) setSummary(null)
      })
  }, [workspaceId])

  const copy = summary ? bannerCopy(summary) : null
  if (!copy) return null

  // One link whose name is its visible text. No live region inside it: a
  // role=status child would leave the link without an accessible name.
  return (
    <aside aria-label="Billing notice">
      <Link
        href={`/workspaces/${workspaceId}/billing`}
        className="flex items-start gap-3 rounded-[12px] border border-flag/30 bg-flag/6 px-4 py-[14px] text-foreground inset-shadow-[3px_0_0_var(--flag)] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
      >
        <AlertTriangle className="mt-px size-[17px] shrink-0 text-flag" aria-hidden="true" />
        <span className="text-[14px] font-semibold">{copy.title}</span>
        <span className="ml-auto shrink-0 text-[14px] font-medium text-primary-strong-hover underline underline-offset-2">
          {copy.action}
        </span>
      </Link>
    </aside>
  )
}
