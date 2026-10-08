/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import RefundPage, { metadata } from './page'

afterEach(cleanup)

describe('Refund page', () => {
  it('error: refund title does not repeat the brand the layout template appends', () => {
    expect(metadata.title).not.toContain('— Optra')
    expect(metadata.title).not.toContain('Optra')
  })

  it('regression: seller line says "based in the Philippines", not "based in Philippines"', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).not.toContain('based in Philippines')
    expect(container.textContent).toContain('an individual based in the Philippines')
  })

  it('edge: renders no undefined or null text from missing facts', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('error: no longer mentions overage charges, because the plans are hard-capped', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).not.toMatch(/overage/i)
    expect(container.textContent).not.toMatch(/non-refundable/i)
  })

  it('edge: states no partial-period refunds after the 14-day window', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).toContain(
      'No partial-period refunds once the 14-day window has passed.',
    )
  })

  it('happy: exports title, description and canonical metadata', () => {
    expect(metadata.title).toBe('Refund Policy')
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toMatch(/\/refund$/)
  })

  it('happy: shows h1, seller identity and the 14 days window', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(screen.getByRole('heading', { level: 1, name: /Refund/ })).not.toBeNull()
    expect(container.textContent).toContain('Romeo Angeles Jr.')
    expect(container.textContent).toContain('Philippines')
    expect(container.textContent).toContain('14 days')
    expect(container.querySelector('a[href="mailto:romeo@tyvera.app"]')).not.toBeNull()
  })
})
