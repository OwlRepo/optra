/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProductCards } from './product-cards'
import { DEMO_HISTORY_ROWS } from '@/lib/landing-demo-docs'

afterEach(cleanup)

describe('ProductCards', () => {
  it('renders the section under the #product anchor the nav targets', () => {
    const { container } = render(<ProductCards />)

    expect(container.querySelector('#product')).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Three ways an invoice quietly costs you money' }),
    ).not.toBeNull()
  })

  it('names all three failure modes', () => {
    render(<ProductCards />)

    expect(screen.getByRole('heading', { name: 'Match once, not line by line' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'The photo is part of the check' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Approve on evidence, not memory' })).not.toBeNull()
  })

  it('shows the price delta that makes the first card concrete', () => {
    render(<ProductCards />)

    expect(screen.getByText('IRN-38HXB · $0.51')).not.toBeNull()
    expect(screen.getByText('+18.0%')).not.toBeNull()
  })

  it('compares two photos with a visual-match caption', () => {
    render(<ProductCards />)

    expect(screen.getByAltText('Ordered item')).not.toBeNull()
    expect(screen.getByAltText('Catalog item')).not.toBeNull()
    expect(screen.getByText('ordered ↔ catalog · 92% visual match')).not.toBeNull()
  })

  it('renders every history row from the shared demo data', () => {
    render(<ProductCards />)

    for (const row of DEMO_HISTORY_ROWS) {
      expect(screen.getByText(`${row.date} · ${row.detail}`)).not.toBeNull()
    }
  })
})
