/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTACT_EMAIL } from '@/lib/legal-facts'
import { PricingPlans } from './pricing-plans'

afterEach(cleanup)

describe('PricingPlans', () => {
  it('error: no longer promises no card or no onboarding call', () => {
    const { container } = render(<PricingPlans />)

    expect(container.textContent).not.toMatch(/no card/i)
    expect(container.textContent).not.toMatch(/no onboarding call/i)
    expect(screen.queryByRole('link', { name: 'Contact sales' })).toBeNull()
  })

  it('error: no per-line overage is offered, because the plans are hard-capped', () => {
    const { container } = render(<PricingPlans />)

    expect(container.textContent).not.toMatch(/Extra lines/i)
    expect(container.textContent).not.toMatch(/\$0\.0[34]/)
  })

  it('error: the trial line no longer says every plan starts with a trial', () => {
    const { container } = render(<PricingPlans />)

    expect(container.textContent).not.toContain('Every plan starts with a 14-day trial')
  })

  it('edge: Solo and Team both say the allowance stops at the monthly cap with no overage charges', () => {
    render(<PricingPlans />)

    expect(screen.getByText('Hard monthly cap, no overage charges. Upgrade anytime')).not.toBeNull()
    expect(screen.getByText('Hard monthly cap, no overage charges. Add buyers anytime')).not.toBeNull()
  })

  it('edge: Scale CTA is a mailto with the Optra Scale subject, not the trial anchor', () => {
    const { container } = render(<PricingPlans />)

    expect(
      container.querySelector('a[href="mailto:romeo@tyvera.app?subject=Optra%20Scale"]'),
    ).not.toBeNull()
    expect(container.querySelectorAll('a[href="#trial"]')).toHaveLength(2)
  })

  it('edge: Scale mailto link carries sr-only (opens email) text', () => {
    render(<PricingPlans />)

    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.startsWith('mailto:'))
    expect(link?.textContent).toContain('(opens email)')
    expect(link?.querySelector('.sr-only')?.textContent).toMatch(/opens email/)
  })

  it('edge: Scale mailto address comes from CONTACT_EMAIL', () => {
    const { container } = render(<PricingPlans />)

    expect(container.querySelector(`a[href^="mailto:${CONTACT_EMAIL}"]`)).not.toBeNull()
  })

  it('regression: the quotas on the page equal quotasFor() in apps/api/src/billing/plans.ts', () => {
    const plans = readFileSync(
      fileURLToPath(new URL('../../../../api/src/billing/plans.ts', import.meta.url)),
      'utf8',
    )
    render(<PricingPlans />)

    expect(plans).toMatch(/\{ matchedLines: 2000 \* seats, photoChecks: 300 \* seats \}/)
    expect(plans).toMatch(/\{ matchedLines: 400, photoChecks: 100 \}/)
    expect(screen.getByText('400 matched line items / month')).not.toBeNull()
    expect(screen.getByText('100 photo checks / month')).not.toBeNull()
    expect(screen.getByText('2,000 matched line items per buyer, pooled')).not.toBeNull()
    expect(screen.getByText('300 photo checks per buyer, pooled')).not.toBeNull()
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
  it('happy: states the metered quotas and photo checks verbatim', () => {
    render(<PricingPlans />)

    expect(screen.getByText('400 matched line items / month')).not.toBeNull()
    expect(screen.getByText('100 photo checks / month')).not.toBeNull()
    expect(screen.getByText('2,000 matched line items per buyer, pooled')).not.toBeNull()
    expect(screen.getByText('300 photo checks per buyer, pooled')).not.toBeNull()
  })

  it('happy: makes per-line-item pricing and the first-workspace 14-day trial explicit', () => {
    render(<PricingPlans />)

    expect(
      screen.getByText(
        /Priced per matched line item, not per document\. Your first workspace starts with a 14-day trial\./i,
      ),
    ).not.toBeNull()
  })
})
