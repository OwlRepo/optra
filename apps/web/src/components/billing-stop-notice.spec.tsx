/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStopBody } from '@repo/types'
import { BillingStopNotice } from './billing-stop-notice'
import { BILLING_STOP_EVENT } from '@/lib/billing-stop'

const STOPS: BillingStopBody[] = [
  {
    statusCode: 402,
    code: 'SUBSCRIPTION_REQUIRED',
    message: 'Your workspace needs an active plan to do this. Choose a plan on the Billing page.',
  },
  {
    statusCode: 402,
    code: 'QUOTA_EXCEEDED',
    quota: 'photoChecks',
    message: "Your plan's photo-check allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
  },
  {
    statusCode: 402,
    code: 'AI_BUDGET_EXCEEDED',
    message: "Your plan's AI allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
  },
]

function announce(detail: BillingStopBody) {
  act(() => {
    window.dispatchEvent(new CustomEvent<BillingStopBody>(BILLING_STOP_EVENT, { detail }))
  })
}

function renderNotice() {
  return render(React.createElement(BillingStopNotice, { workspaceId: 'ws-1' }))
}

describe('BillingStopNotice', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: renders nothing before any event', () => {
    const { container } = renderNotice()

    expect(container.textContent).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('error: an event with a malformed detail renders nothing and does not throw', () => {
    const { container } = renderNotice()

    act(() => {
      window.dispatchEvent(new CustomEvent(BILLING_STOP_EVENT, { detail: null }))
    })

    expect(container.textContent).toBe('')
  })

  it.each(STOPS)('edge: shows the message and a link to the workspace billing page for $code', (stop) => {
    renderNotice()

    announce(stop)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(stop.message)
    const link = screen.getByRole('link', { name: /view billing/i })
    expect(link.getAttribute('href')).toBe('/workspaces/ws-1/billing')
  })

  it('edge: the dismiss button hides it and a later event shows it again', () => {
    renderNotice()
    announce(STOPS[0])

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss billing notice' }))
    expect(screen.queryByRole('alert')).toBeNull()

    announce(STOPS[2])

    expect(screen.getByRole('alert').textContent).toContain(STOPS[2].message)
  })

  it('edge: a later event replaces the message while the notice is open', () => {
    renderNotice()
    announce(STOPS[0])

    announce(STOPS[1])

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain(STOPS[1].message)
    expect(screen.getByRole('alert').textContent).not.toContain(STOPS[0].message)
  })

  it('edge: the container is a role alert named Billing notice', () => {
    renderNotice()
    announce(STOPS[1])

    expect(screen.getByRole('alert', { name: 'Billing notice' })).toBeTruthy()
  })

  it('regression: the listener is removed on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const view = renderNotice()

    view.unmount()

    expect(remove).toHaveBeenCalledWith(BILLING_STOP_EVENT, expect.any(Function))
    expect(() => announce(STOPS[0])).not.toThrow()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('happy: a coded 402 event renders the notice', () => {
    renderNotice()

    announce(STOPS[0])

    expect(screen.getByRole('alert').textContent).toContain('needs an active plan')
    expect(screen.getByRole('link', { name: /view billing/i })).toBeTruthy()
  })
})
