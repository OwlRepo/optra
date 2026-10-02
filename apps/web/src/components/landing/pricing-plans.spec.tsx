/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PricingPlans } from './pricing-plans'

afterEach(cleanup)

describe('PricingPlans', () => {
  it('error: no longer promises no card or no onboarding call', () => {
    const { container } = render(<PricingPlans />)

    expect(container.textContent).not.toMatch(/no card/i)
    expect(container.textContent).not.toMatch(/no onboarding call/i)
    expect(screen.queryByRole('link', { name: 'Contact sales' })).toBeNull()
  })

  it('edge: Scale CTA is a mailto with the Optra Scale subject, not the trial anchor', () => {
    const { container } = render(<PricingPlans />)

    expect(
      container.querySelector('a[href="mailto:romeo@tyvera.app?subject=Optra%20Scale"]'),
    ).not.toBeNull()
    expect(container.querySelectorAll('a[href="#trial"]')).toHaveLength(2)
  })

  it('happy: renders the three plans with their prices and cadences', () => {
    render(<PricingPlans />)

    expect(screen.getByRole('heading', { name: 'Solo' })).not.toBeNull()
    expect(screen.getByText('$29')).not.toBeNull()
    expect(screen.getByText('per month · 1 buyer')).not.toBeNull()

    expect(screen.getByRole('heading', { name: 'Team' })).not.toBeNull()
    expect(screen.getByText('$69')).not.toBeNull()
    expect(screen.getByText('per buyer / month')).not.toBeNull()

    expect(screen.getByRole('heading', { name: 'Scale' })).not.toBeNull()
    expect(screen.getByText('Talk')).not.toBeNull()
  })

  it('happy: emphasises Team as the recommended plan', () => {
    render(<PricingPlans />)

    expect(screen.getByText('Most buyers')).not.toBeNull()
  })

  // Quantified commitments; pinned so changing them is a deliberate product call.
  it('happy: states the metered quotas, photo checks and overage rates verbatim', () => {
    render(<PricingPlans />)

    expect(screen.getByText('400 matched line items / month')).not.toBeNull()
    expect(screen.getByText('100 photo checks / month')).not.toBeNull()
    expect(screen.getByText('Extra lines at $0.04 each')).not.toBeNull()
    expect(screen.getByText('2,000 matched line items per buyer, pooled')).not.toBeNull()
    expect(screen.getByText('300 photo checks per buyer, pooled')).not.toBeNull()
    expect(screen.getByText('Extra lines at $0.03 each')).not.toBeNull()
  })

  it('happy: makes per-line-item pricing and the 14-day trial explicit', () => {
    render(<PricingPlans />)

    expect(
      screen.getByText(
        /Priced per matched line item, not per document\. Every plan starts with a 14-day trial\./i,
      ),
    ).not.toBeNull()
  })
})
