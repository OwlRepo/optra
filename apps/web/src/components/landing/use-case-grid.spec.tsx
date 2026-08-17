/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UseCaseGrid } from './use-case-grid'

afterEach(cleanup)

describe('UseCaseGrid', () => {
  it('renders all six audiences as a list', () => {
    const { container } = render(<UseCaseGrid />)

    expect(container.querySelectorAll('li')).toHaveLength(6)

    for (const label of [
      'Procurement teams',
      'AP / accounts payable',
      'Multi-vendor sourcing',
      'Ops & supply chain',
      'Small business buyers',
      'Founder-led purchasing',
    ]) {
      expect(screen.getByRole('heading', { name: label })).not.toBeNull()
    }
  })

  it('gives each audience a reason, not just a label', () => {
    render(<UseCaseGrid />)

    expect(
      screen.getByText('Match every PO against the vendor catalog before it is approved.'),
    ).not.toBeNull()
    expect(screen.getByText('Keep every order and price searchable from day one.')).not.toBeNull()
  })

  it('leads with the payback framing', () => {
    render(<UseCaseGrid />)

    expect(
      screen.getByRole('heading', {
        name: 'If you buy the same things twice, this pays for itself',
      }),
    ).not.toBeNull()
  })
})
