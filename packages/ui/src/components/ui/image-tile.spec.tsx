/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageTile } from './image-tile'

afterEach(() => {
  cleanup()
})

function setup(overrides: Partial<React.ComponentProps<typeof ImageTile>> = {}) {
  return render(<ImageTile alt="A cat" {...overrides} />)
}

describe('ImageTile', () => {
  it('renders a Skeleton and no img when isLoading', () => {
    setup({ src: 'https://example.com/cat.png', isLoading: true })
    expect(screen.getByTestId('image-tile-skeleton')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders an img with the given src and alt when a valid src is provided', () => {
    setup({ src: 'https://example.com/cat.png', alt: 'A cat' })
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://example.com/cat.png')
    expect(img.getAttribute('alt')).toBe('A cat')
  })

  it('renders the fallback panel and no img when no src is provided', () => {
    setup({ src: undefined })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('image-tile-fallback')).toBeTruthy()
  })

  it('renders the fallback panel and no img when src is an empty string', () => {
    setup({ src: '' })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('image-tile-fallback')).toBeTruthy()
  })

  it('swaps to the fallback panel when the img fails to load', () => {
    setup({ src: 'https://example.com/broken.png' })
    const img = screen.getByRole('img')
    fireEvent.error(img)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('image-tile-fallback')).toBeTruthy()
  })

  it('does not render a caption/badge overlay when neither is passed', () => {
    setup({ src: 'https://example.com/cat.png' })
    expect(screen.queryByText('My caption')).toBeNull()
  })

  it('renders the caption when passed', () => {
    setup({ src: 'https://example.com/cat.png', caption: 'My caption' })
    expect(screen.getByText('My caption')).toBeTruthy()
  })

  it('renders the badge when passed', () => {
    setup({ src: 'https://example.com/cat.png', badge: <span>New</span> })
    expect(screen.getByText('New')).toBeTruthy()
  })
})
