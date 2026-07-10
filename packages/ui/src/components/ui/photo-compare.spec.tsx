/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PhotoCompare, type PhotoCompareProps } from './photo-compare'

afterEach(() => {
  cleanup()
})

function setup(overrides: Partial<PhotoCompareProps> = {}) {
  const props: PhotoCompareProps = {
    query: { sku: 'SKU-100', description: 'Requested widget, 4-pack' },
    candidate: {
      sku: 'SKU-100-V',
      description: 'Vendor widget, 4-pack',
      photoSrc: 'https://cdn.example.com/widget.jpg',
      vendorName: 'Acme Supply',
    },
    verdict: { score: 0.82, isMatch: true, reason: 'Matches on SKU and description' },
    ...overrides,
  }
  render(<PhotoCompare {...props} />)
  return props
}

describe('PhotoCompare', () => {
  it('renders the requested item as text only, with zero images in the left panel', () => {
    setup()
    const leftPanel = screen.getByTestId('photo-compare-query-panel')
    expect(within(leftPanel).getByText('SKU-100')).toBeTruthy()
    expect(within(leftPanel).getByText('Requested widget, 4-pack')).toBeTruthy()
    expect(within(leftPanel).queryAllByRole('img')).toHaveLength(0)
    expect(leftPanel.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders an ImageTile reflecting the candidate photo in the right panel', () => {
    setup()
    const rightPanel = screen.getByTestId('photo-compare-candidate-panel')
    expect(within(rightPanel).getByAltText('SKU-100-V')).toBeTruthy()
  })

  it('shows the vendor name and candidate text details in the right panel', () => {
    setup()
    const rightPanel = screen.getByTestId('photo-compare-candidate-panel')
    expect(within(rightPanel).getByText('Acme Supply')).toBeTruthy()
    expect(within(rightPanel).getByText('SKU-100-V')).toBeTruthy()
    expect(within(rightPanel).getByText('Vendor widget, 4-pack')).toBeTruthy()
  })

  it('falls back to "Candidate" when vendorName is not provided', () => {
    setup({
      candidate: {
        sku: 'SKU-100-V',
        description: 'Vendor widget, 4-pack',
        photoSrc: 'https://cdn.example.com/widget.jpg',
      },
    })
    const rightPanel = screen.getByTestId('photo-compare-candidate-panel')
    expect(within(rightPanel).getByText('Candidate')).toBeTruthy()
  })

  it('shows a Match badge when verdict.isMatch is true', () => {
    setup({ verdict: { score: 0.82, isMatch: true, reason: 'Matches on SKU' } })
    expect(screen.getByText('Match')).toBeTruthy()
  })

  it('shows a No match badge when verdict.isMatch is false', () => {
    setup({ verdict: { score: 0.2, isMatch: false, reason: 'SKU differs' } })
    expect(screen.getByText('No match')).toBeTruthy()
  })

  it('always shows the verdict reason text', () => {
    setup({ verdict: { score: null, isMatch: false, reason: 'No candidate photo available' } })
    expect(screen.getByText('No candidate photo available')).toBeTruthy()
  })

  it('renders no progressbar anywhere in the verdict strip when verdict.score is null', () => {
    setup({ verdict: { score: null, isMatch: true, reason: 'Manual override' } })
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders a progressbar reflecting verdict.score as a 0-100 percentage', () => {
    setup({ verdict: { score: 0.82, isMatch: true, reason: 'Matches on SKU' } })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('82')
  })

  it('shows the candidate ImageTile in a loading state, not a real image, when isLoading is true', () => {
    setup({ isLoading: true })
    const rightPanel = screen.getByTestId('photo-compare-candidate-panel')
    expect(within(rightPanel).queryByRole('img')).toBeNull()
  })
})
