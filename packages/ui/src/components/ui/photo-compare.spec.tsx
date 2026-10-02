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

  it('edge: the candidate photo border takes the verdict tone', () => {
    setup({ verdict: { score: 0.2, isMatch: false, reason: 'SKU differs' } })
    const tile = screen
      .getByTestId('photo-compare-candidate-panel')
      .querySelector('[data-image-frame]')?.parentElement as HTMLElement
    expect(tile.className).toContain('[&_[data-image-frame]]:border-destructive-tone')
    cleanup()
    setup({ verdict: { score: 0.9, isMatch: true, reason: 'Matches on SKU' } })
    const matchTile = screen
      .getByTestId('photo-compare-candidate-panel')
      .querySelector('[data-image-frame]')?.parentElement as HTMLElement
    expect(matchTile.className).toContain('[&_[data-image-frame]]:border-primary-strong')
  })

  it('edge: header renders as the panel\'s first row above the two cells', () => {
    setup({
      header: (
        <>
          <span>Sourcing</span>
          <button type="button">Dismiss</button>
        </>
      ),
    })
    const queryPanel = screen.getByTestId('photo-compare-query-panel')
    const root = queryPanel.parentElement?.parentElement as HTMLElement
    const first = root.firstElementChild as HTMLElement
    expect(first.hasAttribute('data-photo-compare-header')).toBe(true)
    expect(first.className).toContain('border-b')
    expect(first.className).toContain('px-5')
    expect(first.className).toContain('py-3')
    expect(within(first).getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('edge: no header row renders without a header', () => {
    setup()
    const root = screen.getByTestId('photo-compare-query-panel').parentElement?.parentElement as HTMLElement
    expect(root.querySelector('[data-photo-compare-header]')).toBeNull()
  })

  it('edge: the confidence bar is the compact "Conf." meter', () => {
    setup({ verdict: { score: 0.61, isMatch: false, reason: 'Likely substituted' } })
    expect(screen.getByText('Conf.')).toBeTruthy()
    expect(screen.getByText('61%')).toBeTruthy()
  })

  it('regression: requested and candidate are two cells of one hairline panel with a subtle verdict footer', () => {
    setup()
    const queryPanel = screen.getByTestId('photo-compare-query-panel')
    const root = queryPanel.parentElement?.parentElement as HTMLElement
    expect(root.className).toContain('rounded-[18px]')
    expect(root.className).toContain('border-border-panel')
    expect(root.className).toContain('bg-card')
    expect(queryPanel.className).toContain('sm:border-r')
    const footer = root.lastElementChild as HTMLElement
    expect(footer.className).toContain('bg-surface-subtle')
    expect(footer.className).toContain('border-t')
  })

  it('regression: the verdict is a solid pill (white on red for No match, white on teal for Match)', () => {
    setup({ verdict: { score: 0.2, isMatch: false, reason: 'SKU differs' } })
    expect(screen.getByText('No match').className).toContain('bg-destructive-tone')
    expect(screen.getByText('No match').className).toContain('uppercase')
    cleanup()
    setup({ verdict: { score: 0.9, isMatch: true, reason: 'Matches on SKU' } })
    expect(screen.getByText('Match').className).toContain('bg-primary-strong')
  })
})
