/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import RefundPage, { metadata } from './page'

afterEach(cleanup)

describe('Refund page', () => {
  it('edge: renders no undefined or null text from missing facts', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).not.toMatch(/undefined|\bnull\b/)
  })

  it('edge: states no partial-period refunds and non-refundable used overage', () => {
    const { container } = render(React.createElement(RefundPage))

    expect(container.textContent).toMatch(/partial/i)
    expect(container.textContent).toMatch(/overage/i)
    expect(container.textContent).toMatch(/non-refundable/i)
  })

  it('happy: exports title, description and canonical metadata', () => {
    expect(metadata.title).toMatch(/Refund/)
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
