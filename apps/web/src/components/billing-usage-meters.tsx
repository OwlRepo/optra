'use client'

import * as React from 'react'
import { cn } from '@repo/ui'
import type { BillingSummary } from '@repo/types'

function fillClass(percent: number): string {
  if (percent >= 100) return 'bg-destructive-tone'
  if (percent >= 80) return 'bg-flag'
  return 'bg-primary-strong'
}

function Row({ label, text, meter }: { label: string; text: string; meter?: { now: number; max: number; percent: number } }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-foreground">{label}</span>
        <span className="font-mono text-[12px] text-ink-body">{text}</span>
      </div>
      {meter ? (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={meter.max}
          aria-valuenow={meter.now}
          className="mt-2 h-1 overflow-hidden rounded-[3px] bg-surface-subtle"
        >
          <div
            className={cn('h-full rounded-[3px] transition-[width] duration-300', fillClass(meter.percent))}
            style={{ width: `${meter.percent}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US')

function quotaRow(label: string, used: number | null | undefined, quota: number | null): React.ReactNode {
  if (quota === null) return null
  if (typeof used !== 'number') return <Row label={label} text={`${fmt(quota)} a month`} />
  const percent = Math.min(100, (used / quota) * 100)
  return <Row label={label} text={`${fmt(used)} of ${fmt(quota)}`} meter={{ now: used, max: quota, percent }} />
}

export function BillingUsageMeters({ summary, className }: { summary: BillingSummary; className?: string }) {
  const { quotas, used, period } = summary
  if (!quotas || (summary.state !== 'trialing' && summary.state !== 'subscribed')) return null

  const ai = used.aiBudgetPercent
  const resets = period
    ? new Date(period.end).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className={cn('space-y-4', className)}>
      {quotaRow('Matched lines', used.matchedLines, quotas.matchedLines)}
      {quotaRow('Photo checks', used.photoChecks, quotas.photoChecks)}
      {typeof ai === 'number' ? (
        <Row
          label="AI allowance"
          text={ai >= 100 ? 'Allowance reached' : `${ai}% used`}
          meter={{ now: ai, max: 100, percent: Math.min(100, ai) }}
        />
      ) : null}
      {resets ? <p className="text-[12px] text-ink-muted">{`Resets ${resets}`}</p> : null}
    </div>
  )
}
