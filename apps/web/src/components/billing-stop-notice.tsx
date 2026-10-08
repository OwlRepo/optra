'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@repo/ui'
import type { BillingStopBody } from '@repo/types'
import { BILLING_STOP_EVENT, billingStopFrom } from '@/lib/billing-stop'

// Shown when any call in the workspace answers a coded billing 402. Advisory
// and dismissable: it never blocks the page it appears on.
export function BillingStopNotice({ workspaceId }: { workspaceId: string }) {
  const [stop, setStop] = React.useState<BillingStopBody | null>(null)

  React.useEffect(() => {
    const onStop = (event: Event) => {
      const next = billingStopFrom((event as CustomEvent<unknown>).detail)
      if (next) setStop(next)
    }
    window.addEventListener(BILLING_STOP_EVENT, onStop)
    return () => window.removeEventListener(BILLING_STOP_EVENT, onStop)
  }, [])

  if (!stop) return null

  return (
    <aside
      role="alert"
      aria-label="Billing notice"
      className="flex items-start gap-3 rounded-[12px] border border-flag/30 bg-flag/6 px-4 py-[14px] text-foreground inset-shadow-[3px_0_0_var(--flag)]"
    >
      <AlertTriangle className="mt-px size-[17px] shrink-0 text-flag" aria-hidden="true" />
      <p className="text-[14px] font-semibold">{stop.message}</p>
      <Link
        href={`/workspaces/${workspaceId}/billing`}
        className="ml-auto shrink-0 text-[14px] font-medium text-primary-strong-hover underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
      >
        View billing
      </Link>
      <Button variant="ghost" size="icon" aria-label="Dismiss billing notice" onClick={() => setStop(null)}>
        <X aria-hidden="true" />
      </Button>
    </aside>
  )
}
