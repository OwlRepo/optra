/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PhotoGrid, type PhotoGridItem, type PhotoGridProps } from './photo-grid'

afterEach(() => {
  cleanup()
})

const items: PhotoGridItem[] = [
  { id: '1', src: 'https://example.com/1.jpg', alt: 'Photo one' },
  { id: '2', src: 'https://example.com/2.jpg', alt: 'Photo two' },
  { id: '3', src: 'https://example.com/3.jpg', alt: 'Photo three' },
]

function setup(overrides: Partial<PhotoGridProps> = {}) {
  return render(<PhotoGrid items={items} {...overrides} />)
}

describe('PhotoGrid', () => {
  it('renders one tile per item', () => {
    setup()
    expect(screen.getAllByTestId('photo-grid-tile')).toHaveLength(items.length)
  })

  it('applies the lg:grid-cols-3 class to the grid container when maxCols is 3', () => {
    const { container } = setup({ maxCols: 3 })
    const grid = container.firstChild as HTMLElement
    expect(grid.className).toContain('lg:grid-cols-3')
  })

  it('renders the default empty state when items is empty and not loading', () => {
    setup({ items: [] })
    expect(screen.getByText('No photos yet')).toBeTruthy()
    expect(screen.getByText('Photos will appear here once available.')).toBeTruthy()
  })

  it('renders a custom emptyState node instead of the default when provided', () => {
    setup({ items: [], emptyState: <div>Custom empty</div> })
    expect(screen.getByText('Custom empty')).toBeTruthy()
    expect(screen.queryByText('No photos yet')).toBeNull()
  })

  it('renders loadingCount skeleton tiles instead of item tiles when isLoading is true, even if items is non-empty (loading wins)', () => {
    setup({ isLoading: true, loadingCount: 2 })
    expect(screen.getAllByTestId('photo-grid-tile-loading')).toHaveLength(2)
    expect(screen.queryByTestId('photo-grid-tile')).toBeNull()
  })

  it('defaults loadingCount to maxCols when isLoading and loadingCount are set but loadingCount is omitted', () => {
    setup({ isLoading: true, maxCols: 5 })
    expect(screen.getAllByTestId('photo-grid-tile-loading')).toHaveLength(5)
  })
})
