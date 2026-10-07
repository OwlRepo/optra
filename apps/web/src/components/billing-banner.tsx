'use client'

import * as React from 'react'
import Link from 'next/link'
import { StatusBanner } from '@repo/ui'
import type { BillingSummary } from '@repo/types'
import { getBilling } from '@/lib/api/billing'

const DAY_MS = 86_400_000
const WARN_DAYS = 3

function bannerTitle(summary: BillingSummary): string | null {
  if (summary.state === 'trialing' && summary.trialEndsAt) {
    const days = Math.ceil((new Date(summary.trialEndsAt).getTime() - Date.now()) / DAY_MS)
    if (days > WARN_DAYS) return null
    if (days <= 0) return 'Your free trial ends today.'
    return days === 1 ? 'Your free trial ends in 1 day.' : `Your free trial ends in ${days} days.`
  }
  if (summary.state === 'none' && summary.enforced) {
    return 'No active plan. Choose a plan to keep matching orders.'
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

  const title = summary ? bannerTitle(summary) : null
  if (!title) return null

  return (
    <Link
      href={`/workspaces/${workspaceId}/billing`}
      // StatusBanner is role=status, which does not name its parent link.
      aria-label={title}
      className="block rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StatusBanner variant="warning" title={title} />
    </Link>
  )
}
