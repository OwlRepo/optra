/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BillingSummary } from '@repo/types'
import { BillingUsageMeters } from './billing-usage-meters'

function summary(overrides: Partial<BillingSummary> = {}): BillingSummary {
  return {
    state: 'trialing',
    enforced: false,
    plan: null,
    seats: null,
    subscriptionStatus: null,
    trialEndsAt: '2026-10-15T00:00:00.000Z',
    renewsAt: null,
    endsAt: null,
    period: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' },
    quotas: { matchedLines: 400, photoChecks: 100 },
    used: { matchedLines: 120, photoChecks: 12, aiBudgetPercent: 38 },
    ...overrides,
  }
}

const renderMeters = (value: BillingSummary) => render(React.createElement(BillingUsageMeters, { summary: value }))

describe('BillingUsageMeters', () => {
  afterEach(cleanup)

  it('error: null used values render the allowance only, never 0 of N', () => {
    renderMeters(summary({ used: { matchedLines: null, photoChecks: null } }))

    expect(screen.queryByRole('meter', { name: 'Matched lines' })).toBeNull()
    expect(screen.queryByRole('meter', { name: 'Photo checks' })).toBeNull()
    expect(document.body.textContent).toMatch(/400/)
    expect(document.body.textContent).toMatch(/100/)
    expect(document.body.textContent).not.toMatch(/0\s*of\s*400/)
    expect(document.body.textContent).not.toMatch(/0\s*of\s*100/)
  })

  it('edge: unlimited quotas render no line or photo meter', () => {
    renderMeters(summary({ quotas: { matchedLines: null, photoChecks: null }, used: { matchedLines: 5, photoChecks: 5, aiBudgetPercent: 10 } }))

    expect(screen.queryByRole('meter', { name: 'Matched lines' })).toBeNull()
    expect(screen.queryByRole('meter', { name: 'Photo checks' })).toBeNull()
  })

  it.each([
    ['exempt', summary({ state: 'exempt', period: null, quotas: { matchedLines: null, photoChecks: null } })],
    ['none', summary({ state: 'none', period: null, quotas: null })],
  ])('edge: %s renders nothing', (_state, value) => {
    const { container } = renderMeters(value)

    expect(container.textContent).toBe('')
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('edge: a summary without quotas renders nothing even while trialing', () => {
    const { container } = renderMeters(summary({ quotas: null }))

    expect(container.textContent).toBe('')
  })

  it('edge: aiBudgetPercent 100 reads Allowance reached', () => {
    renderMeters(summary({ used: { matchedLines: 1, photoChecks: 1, aiBudgetPercent: 100 } }))

    expect(screen.getByText('Allowance reached')).toBeTruthy()
    expect(screen.queryByText('100% used')).toBeNull()
  })

  it('edge: the bar width is clamped at 100 percent', () => {
    renderMeters(summary({ used: { matchedLines: 500, photoChecks: 12, aiBudgetPercent: 38 } }))

    const meter = screen.getByRole('meter', { name: 'Matched lines' })
    const fill = meter.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('edge: each meter exposes role meter with now, min and max', () => {
    renderMeters(summary())

    const lines = screen.getByRole('meter', { name: 'Matched lines' })
    expect(lines.getAttribute('aria-valuemin')).toBe('0')
    expect(lines.getAttribute('aria-valuemax')).toBe('400')
    expect(lines.getAttribute('aria-valuenow')).toBe('120')
    const photos = screen.getByRole('meter', { name: 'Photo checks' })
    expect(photos.getAttribute('aria-valuemax')).toBe('100')
    expect(photos.getAttribute('aria-valuenow')).toBe('12')
    const ai = screen.getByRole('meter', { name: 'AI allowance' })
    expect(ai.getAttribute('aria-valuemin')).toBe('0')
    expect(ai.getAttribute('aria-valuemax')).toBe('100')
    expect(ai.getAttribute('aria-valuenow')).toBe('38')
  })

  it('happy: lines, photo checks and AI allowance render as figures with a period reset caption', () => {
    renderMeters(summary({ quotas: { matchedLines: 2000, photoChecks: 300 }, used: { matchedLines: 1250, photoChecks: 12, aiBudgetPercent: 38 } }))

    expect(screen.getByText('Matched lines')).toBeTruthy()
    expect(screen.getByText('1,250 of 2,000')).toBeTruthy()
    expect(screen.getByText('Photo checks')).toBeTruthy()
    expect(screen.getByText('12 of 300')).toBeTruthy()
    expect(screen.getByText('AI allowance')).toBeTruthy()
    expect(screen.getByText('38% used')).toBeTruthy()
    expect(screen.getByText(/^Resets /)).toBeTruthy()
  })
})
