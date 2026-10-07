/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MetricsStrip } from './metrics-strip'

afterEach(cleanup)

describe('MetricsStrip', () => {
  it('error: shows none of the invented placeholder figures', () => {
    const { container } = render(<MetricsStrip />)

    expect(container.textContent).not.toContain('<10s')
    expect(container.textContent).not.toContain('94%')
    expect(container.textContent).not.toContain('−42%')
    expect(container.textContent).not.toMatch(/Avg\. match time|Catalog coverage|Manual review time/)
  })

  it('regression: the overclaiming Every line wording is gone', () => {
    render(<MetricsStrip />)

    expect(screen.queryByText('Every line')).toBeNull()
  })

  it('edge: names no vendor, logo slot or illustrative footnote', () => {
    const { container } = render(<MetricsStrip />)

    expect(screen.queryByText('Vendor logo')).toBeNull()
    expect(screen.queryByText('Your company')).toBeNull()
    expect(screen.queryByText(/Catalogs from/i)).toBeNull()
    expect(container.textContent).not.toMatch(/illustrative/i)
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('happy: renders the three verifiable facts', () => {
    render(<MetricsStrip />)

    expect(screen.getByText('Formats read')).not.toBeNull()
    expect(screen.getByText('PDF · CSV · XLSX · Photo')).not.toBeNull()
    expect(screen.getByText('Lines checked')).not.toBeNull()
    expect(screen.getByText('Each PO line')).not.toBeNull()
    expect(screen.getByText('Final call')).not.toBeNull()
    expect(screen.getByText('A person')).not.toBeNull()
  })
})
