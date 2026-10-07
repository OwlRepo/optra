/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import type { BillingSummary } from '@repo/types'
import BillingPage from './page'
import { WorkspaceProvider } from '@/components/workspace-context'

const pushMock = vi.fn()
const getBillingMock = vi.fn()
const startCheckoutMock = vi.fn()
const openPortalMock = vi.fn()
const getWorkspaceMock = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/workspaces/ws-1/billing',
  useSearchParams: () => searchParams,
}))

vi.mock('@/lib/api/billing', () => ({
  getBilling: (...args: unknown[]) => getBillingMock(...args),
  startCheckout: (...args: unknown[]) => startCheckoutMock(...args),
  openPortal: (...args: unknown[]) => openPortalMock(...args),
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

vi.mock('@/lib/api/events', () => ({
  getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
}))

const assignMock = vi.fn()

function summary(overrides: Partial<BillingSummary> = {}): BillingSummary {
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

function trialingSummary(overrides: Partial<BillingSummary> = {}) {
  return summary({
    state: 'trialing',
    trialEndsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    // Deliberately not 400/100: the page must print what the summary says.
    quotas: { matchedLines: 123, photoChecks: 45 },
    period: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' },
    ...overrides,
  })
}

function subscribedSummary(overrides: Partial<BillingSummary> = {}) {
  return summary({
    state: 'subscribed',
    plan: 'team',
    seats: 3,
    subscriptionStatus: 'active',
    renewsAt: '2026-11-08T12:00:00.000Z',
    quotas: { matchedLines: 6000, photoChecks: 900 },
    period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
    ...overrides,
  })
}

function asRole(role: 'owner' | 'admin' | 'member') {
  getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role })
}

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(
        WorkspaceProvider,
        { workspaceId: 'ws-1' },
        React.createElement(BillingPage, { params: { id: 'ws-1' } }),
      ),
    ),
  )
}

// Fake-timer cases cannot use waitFor/findBy (they poll on real timers).
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const subscribeTeam = () => screen.getByRole('button', { name: /subscribe.*team/i })
const subscribeSolo = () => screen.getByRole('button', { name: /subscribe.*solo/i })

describe('BillingPage', () => {
  const originalLocation = window.location

  beforeEach(() => {
    pushMock.mockReset()
    getBillingMock.mockReset()
    startCheckoutMock.mockReset()
    openPortalMock.mockReset()
    getWorkspaceMock.mockReset()
    assignMock.mockReset()
    searchParams = new URLSearchParams()
    asRole('owner')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('error: a failed summary load shows the error banner and Retry reloads', async () => {
    getBillingMock.mockRejectedValueOnce({ statusCode: 500, message: 'boom' })
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()

    expect(await screen.findByText("Couldn't load billing.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/days left/i)).toBeTruthy()
    expect(getBillingMock).toHaveBeenCalledTimes(2)
  })

  it('error: a member sees no Subscribe or Manage button and the owner-only note', async () => {
    asRole('member')
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()

    expect(await screen.findByText('Only the workspace owner can change billing.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull()
  })

  it('error: an admin sees the owner-only note too', async () => {
    asRole('admin')
    getBillingMock.mockResolvedValue(subscribedSummary())

    renderPage()

    expect(await screen.findByText('Only the workspace owner can change billing.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
  })

  it('error: a 409 from checkout toasts and reloads the summary', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())
    startCheckoutMock.mockRejectedValue({ statusCode: 409, message: 'This workspace already has a subscription. Use Manage billing.' })

    renderPage()
    await screen.findByText(/days left/i)
    fireEvent.click(subscribeSolo())

    expect(await screen.findByText('This workspace already has a subscription')).toBeTruthy()
    await waitFor(() => expect(getBillingMock).toHaveBeenCalledTimes(2))
    expect(assignMock).not.toHaveBeenCalled()
  })

  it.each([502, 503])('error: a %i from checkout toasts and keeps the page', async (statusCode) => {
    getBillingMock.mockResolvedValue(trialingSummary())
    startCheckoutMock.mockRejectedValue({ statusCode, message: 'Billing provider unavailable. Try again in a moment.' })

    renderPage()
    await screen.findByText(/days left/i)
    fireEvent.click(subscribeSolo())

    expect(await screen.findByText("Couldn't reach billing. Try again in a moment.")).toBeTruthy()
    expect(screen.getByRole('button', { name: /subscribe.*solo/i })).toBeTruthy()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('error: a 403 shows the access-denied panel', async () => {
    getBillingMock.mockRejectedValue({ statusCode: 403, message: 'Forbidden' })

    renderPage()

    expect(await screen.findByText("You don't have access to this workspace")).toBeTruthy()
  })

  it('error: a 401 sends the visitor to /login', async () => {
    getBillingMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'))
  })

  it('edge: loading shows skeletons', async () => {
    getBillingMock.mockReturnValue(new Promise(() => {}))

    const { container } = renderPage()

    expect(container.querySelector('[data-slot="skeleton"], .animate-pulse')).not.toBeNull()
    expect(screen.queryByText(/days left/i)).toBeNull()
    expect(screen.queryByText("Couldn't load billing.")).toBeNull()
  })

  it('edge: trialing shows the days left and the Solo allowance from the summary quotas', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()

    expect(await screen.findByText(/9 days left/i)).toBeTruthy()
    const body = document.body.textContent ?? ''
    expect(body).toContain('123')
    expect(body).toContain('45')
    expect(body).toMatch(/Solo allowance/i)
  })

  it('edge: none with enforced false does not say work is paused', async () => {
    getBillingMock.mockResolvedValue(summary({ state: 'none', enforced: false }))

    renderPage()

    expect(await screen.findByText('No active plan')).toBeTruthy()
    expect(screen.queryByText(/paused/i)).toBeNull()
  })

  it('edge: none with enforced true says work is paused', async () => {
    getBillingMock.mockResolvedValue(summary({ state: 'none', enforced: true }))

    renderPage()

    expect(await screen.findByText('No active plan')).toBeTruthy()
    expect(screen.getByText(/paused/i)).toBeTruthy()
  })

  it('edge: exempt shows the exempt note and no plan cards', async () => {
    getBillingMock.mockResolvedValue(summary({ state: 'exempt', quotas: { matchedLines: null, photoChecks: null } }))

    renderPage()

    expect(await screen.findByText('This workspace is exempt from billing.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
    expect(screen.queryByLabelText('Number of buyers')).toBeNull()
  })

  it('edge: the seat stepper stops at 1 and 25 and marks the bound with aria-disabled, not disabled', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()
    await screen.findByText(/days left/i)
    // aria-label sits on the stepper container; its first button lowers, its last raises.
    const stepper = screen.getByLabelText('Number of buyers')
    const [decrease, increase] = [within(stepper).getAllByRole('button')[0], within(stepper).getAllByRole('button').at(-1)!]
    const atBound = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'

    expect(atBound(decrease)).toBe(true)
    expect((decrease as HTMLButtonElement).disabled).toBe(false)
    for (let i = 0; i < 30; i++) {
      if (atBound(increase)) break
      fireEvent.click(increase)
    }
    expect(atBound(increase)).toBe(true)
    expect((increase as HTMLButtonElement).disabled).toBe(false)
    expect(stepper.textContent).toContain('25')
    expect(atBound(decrease)).toBe(false)
    for (let i = 0; i < 30; i++) {
      if (atBound(decrease)) break
      fireEvent.click(decrease)
    }
    expect(atBound(decrease)).toBe(true)
    expect(stepper.textContent).toContain('1')
    expect(stepper.textContent).not.toContain('25')
  })

  it('edge: clicking a stepper button at its bound is a no-op', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()
    await screen.findByText(/days left/i)
    const stepper = screen.getByLabelText('Number of buyers')
    const [decrease, increase] = [within(stepper).getAllByRole('button')[0], within(stepper).getAllByRole('button').at(-1)!]

    fireEvent.click(decrease)
    expect(within(stepper).getByText('1')).toBeTruthy()
    for (let i = 0; i < 24; i++) fireEvent.click(increase)
    expect(within(stepper).getByText('25')).toBeTruthy()
    fireEvent.click(increase)
    expect(within(stepper).getByText('25')).toBeTruthy()
  })

  it('edge: the seat count is announced politely (aria-live=polite)', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()
    await screen.findByText(/days left/i)
    const stepper = screen.getByLabelText('Number of buyers')

    expect(within(stepper).getByText('1').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
  })

  it('edge: the loading skeleton is role=status with screen-reader text "Loading billing"', async () => {
    getBillingMock.mockReturnValue(new Promise(() => {}))

    renderPage()

    const text = screen.getByText('Loading billing')
    expect(text.className).toContain('sr-only')
    expect(text.closest('[role="status"]')).not.toBeNull()
  })

  it('edge: the allowance line is hidden when the summary has no quotas', async () => {
    getBillingMock.mockResolvedValue(trialingSummary({ quotas: null }))

    renderPage()

    expect(await screen.findByText(/days left/i)).toBeTruthy()
    expect(screen.queryByText(/Solo allowance/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/0 matched lines/)
  })

  it('edge: a non-owner does not see the seat stepper', async () => {
    asRole('member')
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()

    await screen.findByText('Only the workspace owner can change billing.')
    expect(screen.queryByLabelText('Number of buyers')).toBeNull()
    expect(screen.queryByRole('button', { name: /(increase|decrease) buyers/i })).toBeNull()
  })

  it('edge: the owner-only note sits in the "Choose a plan" section and is referenced via aria-describedby', async () => {
    asRole('member')
    getBillingMock.mockResolvedValue(trialingSummary())

    const { container } = renderPage()

    const note = await screen.findByText('Only the workspace owner can change billing.')
    const heading = screen.getByRole('heading', { name: 'Choose a plan' })
    expect(heading.closest('section')?.contains(note)).toBe(true)
    expect(note.id).not.toBe('')
    expect(container.querySelector(`[aria-describedby~="${note.id}"]`)).not.toBeNull()
  })

  it('edge: after a checkout failure focus returns to the Subscribe button that was clicked', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())
    // Browsers drop focus when a focused button becomes disabled; model that.
    startCheckoutMock.mockImplementation(async () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      throw { statusCode: 502, message: 'down' }
    })

    renderPage()
    await screen.findByText(/days left/i)
    const solo = subscribeSolo()
    solo.focus()
    fireEvent.click(solo)

    await screen.findByText("Couldn't reach billing. Try again in a moment.")
    await waitFor(() => expect(document.activeElement).toBe(subscribeSolo()))
  })

  it('edge: Retry keeps focus and the error banner stays mounted while the reload is in flight', async () => {
    let resolveSecond: (value: BillingSummary) => void = () => {}
    getBillingMock.mockRejectedValueOnce({ statusCode: 500, message: 'boom' })
    getBillingMock.mockReturnValueOnce(new Promise<BillingSummary>((resolve) => (resolveSecond = resolve)))

    renderPage()
    await screen.findByText("Couldn't load billing.")
    const retry = screen.getByRole('button', { name: /retry/i })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(getBillingMock).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Couldn't load billing.")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /retry/i }))

    await act(async () => {
      resolveSecond(trialingSummary())
    })
    expect(await screen.findByText(/days left/i)).toBeTruthy()
  })

  it('edge: ?checkout=success polls every 2 s until subscribed and then stops', async () => {
    vi.useFakeTimers()
    searchParams = new URLSearchParams('checkout=success')
    getBillingMock
      .mockResolvedValueOnce(trialingSummary())
      .mockResolvedValueOnce(trialingSummary())
      .mockResolvedValue(subscribedSummary())

    renderPage()
    await flush()
    expect(screen.getByText(/Payment received\. Activating your plan/)).toBeTruthy()
    expect(getBillingMock).toHaveBeenCalledTimes(1)

    await flush(2000)
    expect(getBillingMock).toHaveBeenCalledTimes(2)
    await flush(2000)
    expect(getBillingMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(/Activating your plan/)).toBeNull()

    await flush(30_000)
    expect(getBillingMock).toHaveBeenCalledTimes(3)
  })

  it('edge: ?checkout=success gives up after 10 reads with the longer-than-usual message', async () => {
    vi.useFakeTimers()
    searchParams = new URLSearchParams('checkout=success')
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()
    await flush()
    await flush(60_000)

    expect(screen.getByText('This is taking longer than usual. Refresh in a minute.')).toBeTruthy()
    const reads = getBillingMock.mock.calls.length
    expect(reads).toBeGreaterThanOrEqual(10)
    expect(reads).toBeLessThanOrEqual(11)

    await flush(60_000)
    expect(getBillingMock).toHaveBeenCalledTimes(reads)
  })

  it('regression: ?checkout=success keeps one persistent role=status region whose text goes Payment received, then Your plan is active.', async () => {
    vi.useFakeTimers()
    searchParams = new URLSearchParams('checkout=success')
    getBillingMock.mockResolvedValueOnce(trialingSummary()).mockResolvedValue(subscribedSummary())

    renderPage()
    await flush()
    const region = screen.getByText('Payment received. Activating your plan…').closest('[role="status"]') as HTMLElement
    expect(region).not.toBeNull()

    await flush(2000)

    expect(region.isConnected).toBe(true)
    expect(region.textContent).toContain('Your plan is active.')
    expect(region.textContent).not.toContain('Payment received')
    expect(screen.getByText('Your plan is active.').closest('[role="status"]')).toBe(region)
  })

  it('regression: ?checkout=success region text switches to "This is taking longer than usual. Refresh in a minute." in the same node', async () => {
    vi.useFakeTimers()
    searchParams = new URLSearchParams('checkout=success')
    getBillingMock.mockResolvedValue(trialingSummary())

    renderPage()
    await flush()
    const region = screen.getByText('Payment received. Activating your plan…').closest('[role="status"]') as HTMLElement
    expect(region).not.toBeNull()

    await flush(60_000)

    expect(region.isConnected).toBe(true)
    expect(region.textContent).toContain('This is taking longer than usual. Refresh in a minute.')
  })

  it('regression: a null used value renders the allowance, never a 0 of N meter', async () => {
    getBillingMock.mockResolvedValue(subscribedSummary({ plan: 'solo', seats: 1, quotas: { matchedLines: 400, photoChecks: 100 } }))

    renderPage()

    await screen.findByText(/active/i)
    expect(document.body.textContent).toMatch(/400/)
    expect(document.body.textContent).not.toMatch(/0\s*(\/|of)\s*400/)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('regression: a cancelled subscription shows the access-until date', async () => {
    getBillingMock.mockResolvedValue(
      subscribedSummary({ subscriptionStatus: 'cancelled', endsAt: '2026-11-15T12:00:00.000Z' }),
    )

    renderPage()

    const line = await screen.findByText(/access until/i)
    expect(line.textContent).toMatch(/15/)
    expect(line.textContent).toMatch(/Nov/)
  })

  it('happy: the owner\'s Subscribe calls startCheckout with plan and seats and navigates to the url', async () => {
    getBillingMock.mockResolvedValue(trialingSummary())
    startCheckoutMock.mockResolvedValue({ url: 'https://ls.test/checkout/abc' })

    renderPage()
    await screen.findByText(/days left/i)
    const stepper = screen.getByLabelText('Number of buyers')
    const increase = within(stepper).getAllByRole('button').at(-1)!
    fireEvent.click(increase)
    fireEvent.click(increase)
    fireEvent.click(subscribeTeam())

    await waitFor(() => expect(startCheckoutMock).toHaveBeenCalledWith('ws-1', { plan: 'team', seats: 3 }))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://ls.test/checkout/abc'))
  })

  it('happy: a subscribed owner\'s Manage billing calls openPortal and navigates to the url', async () => {
    getBillingMock.mockResolvedValue(subscribedSummary())
    openPortalMock.mockResolvedValue({ url: 'https://ls.test/billing/xyz' })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /manage billing/i }))

    await waitFor(() => expect(openPortalMock).toHaveBeenCalledWith('ws-1'))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://ls.test/billing/xyz'))
  })

  describe('usage meters (S4)', () => {
    it('edge: a trialing summary renders the meters inside the trial card', async () => {
      getBillingMock.mockResolvedValue(
        trialingSummary({ used: { matchedLines: 20, photoChecks: 5, aiBudgetPercent: 38 } }),
      )

      renderPage()

      const days = await screen.findByText(/9 days left/i)
      const lines = await screen.findByRole('meter', { name: 'Matched lines' })
      expect(screen.getByRole('meter', { name: 'Photo checks' })).toBeTruthy()
      expect(screen.getByRole('meter', { name: 'AI allowance' })).toBeTruthy()
      // The meters sit in the same card as the trial status, not in a separate section.
      let card: HTMLElement | null = days
      while (card && !card.contains(lines)) card = card.parentElement
      expect(card).not.toBeNull()
      expect(card).not.toBe(document.body)
    })

    it('edge: a subscribed summary renders the meters inside the plan card', async () => {
      getBillingMock.mockResolvedValue(
        subscribedSummary({ used: { matchedLines: 1500, photoChecks: 100, aiBudgetPercent: 61 } }),
      )

      renderPage()

      const lines = await screen.findByRole('meter', { name: 'Matched lines' })
      expect(screen.getByRole('meter', { name: 'Photo checks' })).toBeTruthy()
      expect(screen.getByRole('meter', { name: 'AI allowance' })).toBeTruthy()
      const manage = screen.getByRole('button', { name: /manage billing/i })
      let card: HTMLElement | null = manage
      while (card && !card.contains(lines)) card = card.parentElement
      expect(card).not.toBeNull()
      expect(card).not.toBe(document.body)
    })

    it('regression: exempt and none still render no meters', async () => {
      getBillingMock.mockResolvedValueOnce(
        summary({ state: 'exempt', quotas: { matchedLines: null, photoChecks: null }, used: { matchedLines: 9, photoChecks: 9, aiBudgetPercent: 9 } }),
      )
      const first = renderPage()
      await screen.findByText('This workspace is exempt from billing.')
      expect(screen.queryByRole('meter')).toBeNull()
      first.unmount()

      getBillingMock.mockResolvedValueOnce(summary({ state: 'none', used: { matchedLines: 0, photoChecks: 0, aiBudgetPercent: 0 } }))
      renderPage()
      await screen.findByText('No active plan')
      expect(screen.queryByRole('meter')).toBeNull()
    })

    it('happy: used numbers from the API appear as N of M', async () => {
      getBillingMock.mockResolvedValue(
        trialingSummary({ used: { matchedLines: 20, photoChecks: 5, aiBudgetPercent: 38 } }),
      )

      renderPage()

      expect(await screen.findByText('20 of 123')).toBeTruthy()
      expect(screen.getByText('5 of 45')).toBeTruthy()
      expect(screen.getByText('38% used')).toBeTruthy()
    })
  })
})
