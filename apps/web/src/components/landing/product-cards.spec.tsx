/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProductCards } from './product-cards'
import { DEMO_DOCS, DEMO_HISTORY_ROWS } from '@/lib/landing-demo-docs'

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

    // The card restates demo line L03, so its delta is measured the same way:
    // against the PO price.
    const l03 = DEMO_DOCS[0].lines[1]
    const po = Number(l03.poPrice.slice(1))
    const catalog = Number(l03.catPrice.slice(1))
    expect(screen.getByText(`IRN-38HXB · ${l03.catPrice}`)).not.toBeNull()
    expect(screen.getByText(`+${(((catalog - po) / po) * 100).toFixed(1)}%`)).not.toBeNull()
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
