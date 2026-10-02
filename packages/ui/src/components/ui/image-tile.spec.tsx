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

  it('regression: the caption renders below the photo in Mono 11, not over it on a black fade', () => {
    const { container } = setup({ src: 'https://example.com/cat.png', caption: 'IRN-38HXB · 3/8in hex bolt' })
    const caption = screen.getByText('IRN-38HXB · 3/8in hex bolt')
    expect(caption.className).toContain('font-mono')
    expect(caption.className).toContain('text-[11px]')
    expect(caption.className).toContain('truncate')
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull()
    const frame = container.querySelector('[data-image-frame]')
    expect(frame?.contains(caption)).toBe(false)
  })

  it('regression: the photo frame is a 12px hairline tile', () => {
    const { container } = setup({ src: 'https://example.com/cat.png' })
    const frame = container.querySelector('[data-image-frame]') as HTMLElement
    expect(frame.className).toContain('rounded-[12px]')
    expect(frame.className).toContain('border-border-segmented')
    expect(frame.className).not.toContain('rounded-2xl')
  })

  it('edge: a node caption renders as given below the photo, outside the frame', () => {
    const { container } = setup({
      src: 'https://example.com/cat.png',
      caption: (
        <>
          <span>IRN-38HXB</span>
          <span>3/8in hex bolt</span>
        </>
      ),
    })
    const sku = screen.getByText('IRN-38HXB')
    expect(screen.getByText('3/8in hex bolt')).toBeTruthy()
    expect(container.querySelector('[data-image-frame]')?.contains(sku)).toBe(false)
    expect(sku.parentElement?.className).toContain('min-w-0')
  })

  it('regression: the missing-photo tile shows a "no photo" micro label on the subtle fill', () => {
    setup({ src: undefined })
    const fallback = screen.getByTestId('image-tile-fallback')
    expect(fallback.className).toContain('bg-surface-subtle')
    expect(screen.getByText('no photo')).toBeTruthy()
  })
})
