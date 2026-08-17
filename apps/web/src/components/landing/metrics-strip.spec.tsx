/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MetricsStrip } from './metrics-strip'

afterEach(cleanup)

describe('MetricsStrip', () => {
  it('renders the three headline metrics', () => {
    render(<MetricsStrip />)

    expect(screen.getByText('Avg. match time')).not.toBeNull()
    expect(screen.getByText('<10s')).not.toBeNull()
    expect(screen.getByText('Catalog coverage')).not.toBeNull()
    expect(screen.getByText('94%')).not.toBeNull()
    expect(screen.getByText('Manual review time')).not.toBeNull()
    expect(screen.getByText('−42%')).not.toBeNull()
  })

  // The figures above are illustrative, not measured. The footnote is the only
  // thing keeping them honest, so it is pinned rather than left to drift.
  it('keeps the illustrative-figures footnote next to the numbers', () => {
    render(<MetricsStrip />)

    expect(
      screen.getByText(
        /Illustrative figures from internal test runs on repeat vendor invoices — not a customer average\./i,
      ),
    ).not.toBeNull()
  })

  it('renders four generic vendor slots', () => {
    render(<MetricsStrip />)

    expect(screen.getAllByText('Vendor logo')).toHaveLength(3)
    expect(screen.getByText('Your company')).not.toBeNull()
  })

  // "Catalogs from" asserts a relationship with whoever is named. Until real
  // vendors are actually users, naming one would be a false endorsement claim
  // rather than placeholder copy -- so the slots must stay generic.
  it('names no real company under the catalogs-from label', () => {
    const { container } = render(<MetricsStrip />)

    const slots = Array.from(container.querySelectorAll('li')).map((li) => li.textContent?.trim())
    expect(slots).toEqual(['Vendor logo', 'Vendor logo', 'Vendor logo', 'Your company'])
  })

  // Until real logo files land, the slots render text wordmarks. If someone
  // wires up `src`, this flips to <img> and the assertion should be updated
  // deliberately rather than silently.
  it('renders wordmarks, not images, while no logo assets exist', () => {
    const { container } = render(<MetricsStrip />)

    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
