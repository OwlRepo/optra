/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PricingPlans } from './pricing-plans'

afterEach(cleanup)

describe('PricingPlans', () => {
  it('renders the three plans with their prices and cadences', () => {
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

  it('emphasises Team as the recommended plan', () => {
    render(<PricingPlans />)

    expect(screen.getByText('Most buyers')).not.toBeNull()
  })

  // These are quantified commitments. No backend meter enforces them yet (see
  // the Landing Pricing Copy row in docs/ai/risk-register.md), so the exact
  // numbers are pinned -- changing them should be a deliberate product call.
  it('states the metered quotas and overage rates verbatim', () => {
    render(<PricingPlans />)

    expect(screen.getByText('400 matched line items / month')).not.toBeNull()
    expect(screen.getByText('Extra lines at $0.04 each')).not.toBeNull()
    expect(screen.getByText('2,000 matched line items per buyer, pooled')).not.toBeNull()
    expect(screen.getByText('Extra lines at $0.03 each')).not.toBeNull()
  })

  it('makes the per-line-item pricing model explicit rather than per-document', () => {
    render(<PricingPlans />)

    expect(screen.getByText(/Priced per matched line item, not per document/i)).not.toBeNull()
  })

  it('points every plan CTA at the trial anchor', () => {
    const { container } = render(<PricingPlans />)

    expect(container.querySelectorAll('a[href="#trial"]')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Contact sales' })).not.toBeNull()
  })
})
