/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtractionReveal } from './extraction-reveal'

afterEach(cleanup)

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('ExtractionReveal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the real text content by default (reconstructed across scrambled char spans, not garbled)', async () => {
    stubReducedMotion(false)
    const { container } = render(<ExtractionReveal>PO 4417 Line 3</ExtractionReveal>)
    await vi.waitFor(() => {
      expect(container.textContent).toBe('PO 4417 Line 3')
    })
  })

  it('renders plain static text under reduced motion, with no per-character span split', () => {
    stubReducedMotion(true)
    const { container } = render(<ExtractionReveal>PO 4417 Line 3</ExtractionReveal>)
    expect(screen.getByText('PO 4417 Line 3')).not.toBeNull()
    expect(container.querySelector('[data-content]')).toBeNull()
  })
})
