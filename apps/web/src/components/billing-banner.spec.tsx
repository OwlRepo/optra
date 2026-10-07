/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary } from '@repo/types'
import { BillingBanner } from './billing-banner'

const getBillingMock = vi.fn()

vi.mock('@/lib/api/billing', () => ({
  getBilling: (...args: unknown[]) => getBillingMock(...args),
}))

const NOW = new Date('2026-10-08T12:00:00.000Z')

function summary(overrides: Partial<BillingSummary>): BillingSummary {
  return {
    state: 'none',
    enforced: false,
    plan: null,
    seats: null,
    subscriptionStatus: null,
    trialEndsAt: null,
    renewsAt: null,
    endsAt: null,
    period: null,
    quotas: null,
    used: { matchedLines: null, photoChecks: null },
    ...overrides,
  }
}

function trialing(msFromNow: number, overrides: Partial<BillingSummary> = {}) {
  return summary({
    state: 'trialing',
    trialEndsAt: new Date(NOW.getTime() + msFromNow).toISOString(),
    quotas: { matchedLines: 400, photoChecks: 100 },
    ...overrides,
  })
}

const DAY = 86_400_000

async function renderBanner() {
  const view = render(React.createElement(BillingBanner, { workspaceId: 'ws-1' }))
  await waitFor(() => expect(getBillingMock).toHaveBeenCalledWith('ws-1'))
  // let the resolved promise commit before asserting "renders nothing"
  await new Promise((resolve) => setTimeout(resolve, 0))
  return view
}

describe('BillingBanner', () => {
  beforeEach(() => {
    getBillingMock.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('error: a failed fetch renders nothing', async () => {
    getBillingMock.mockRejectedValue({ statusCode: 500, message: 'boom' })

    const { container } = await renderBanner()

    expect(container.textContent).toBe('')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each([
    ['subscribed', summary({ state: 'subscribed', plan: 'solo', seats: 1, subscriptionStatus: 'active' })],
    ['exempt', summary({ state: 'exempt' })],
  ])('edge: %s renders nothing', async (_state, value) => {
    getBillingMock.mockResolvedValue(value)

    const { container } = await renderBanner()

    expect(container.textContent).toBe('')
  })

  it('edge: trialing with 4 days left renders nothing', async () => {
    getBillingMock.mockResolvedValue(trialing(4 * DAY))

    const { container } = await renderBanner()

    expect(container.textContent).toBe('')
  })

  it('edge: none with enforced false renders nothing', async () => {
    getBillingMock.mockResolvedValue(summary({ state: 'none', enforced: false }))

    const { container } = await renderBanner()

    expect(container.textContent).toBe('')
  })

  it('regression: 1 day left reads "ends in 1 day" and 0 days reads "ends today"', async () => {
    getBillingMock.mockResolvedValueOnce(trialing(DAY))
    const first = await renderBanner()
    expect(await screen.findByText(/Your free trial ends in 1 day\./)).toBeTruthy()
    first.unmount()

    getBillingMock.mockResolvedValueOnce(trialing(0))
    await renderBanner()
    expect(await screen.findByText(/Your free trial ends today\./)).toBeTruthy()
  })

  it('happy: trialing with 3 days left links to the billing page', async () => {
    getBillingMock.mockResolvedValue(trialing(3 * DAY))

    await renderBanner()

    const link = await screen.findByRole('link', { name: /Your free trial ends in 3 days\./ })
    expect(link.getAttribute('href')).toBe('/workspaces/ws-1/billing')
  })

  it('happy: none with enforced true shows the no-plan banner', async () => {
    getBillingMock.mockResolvedValue(summary({ state: 'none', enforced: true }))

    await renderBanner()

    const link = await screen.findByRole('link', { name: /No active plan\. Choose a plan to keep matching orders\./ })
    expect(link.getAttribute('href')).toBe('/workspaces/ws-1/billing')
  })
})
