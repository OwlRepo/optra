/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductTour } from './product-tour'
import { TOUR_CHAT_EXCHANGE, TOUR_VIGNETTES } from '@/lib/landing-demo-docs'

const DWELL_MS = 5200

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  stubReducedMotion(false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ProductTour', () => {
  it('renders one tab per vignette with exactly one selected', () => {
    render(<ProductTour />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(TOUR_VIGNETTES.length)
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })

  it('wires each tab to its panel', () => {
    render(<ProductTour />)

    const selected = screen
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')
    const panel = screen.getByRole('tabpanel')

    expect(panel.getAttribute('id')).toBe(selected?.getAttribute('aria-controls'))
    expect(panel.getAttribute('aria-labelledby')).toBe(selected?.getAttribute('id'))
  })

  it('advances on its own while playing', () => {
    vi.useFakeTimers()
    render(<ProductTour />)

    expect(screen.getByRole('heading', { name: TOUR_VIGNETTES[0].title })).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(DWELL_MS)
    })

    expect(screen.getByRole('heading', { name: TOUR_VIGNETTES[1].title })).not.toBeNull()
  })

  // WCAG 2.2.2: moving content lasting more than five seconds needs a
  // mechanism to stop it, and it has to be a real control, not hover-only.
  it('exposes a pause control that halts autoplay', () => {
    vi.useFakeTimers()
    render(<ProductTour />)

    fireEvent.click(screen.getByRole('button', { name: /pause tour/i }))

    expect(screen.getByRole('button', { name: /play tour/i }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    act(() => {
      vi.advanceTimersByTime(DWELL_MS * 3)
    })

    // Still on the first vignette.
    expect(screen.getByRole('heading', { name: TOUR_VIGNETTES[0].title })).not.toBeNull()
  })

  it('selecting a vignette shows it and pauses autoplay so it cannot slide away', () => {
    vi.useFakeTimers()
    render(<ProductTour />)

    const last = TOUR_VIGNETTES[TOUR_VIGNETTES.length - 1]
    fireEvent.click(screen.getByRole('tab', { name: last.chip }))

    expect(screen.getByRole('heading', { name: last.title })).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(DWELL_MS * 2)
    })

    expect(screen.getByRole('heading', { name: last.title })).not.toBeNull()
  })

  it('does not autoplay under reduced motion', () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    render(<ProductTour />)

    act(() => {
      vi.advanceTimersByTime(DWELL_MS * 3)
    })

    expect(screen.getByRole('heading', { name: TOUR_VIGNETTES[0].title })).not.toBeNull()
  })

  it('labels every frame as illustrative rather than customer data', () => {
    render(<ProductTour />)

    expect(screen.getByText(/illustrative example · not customer data/i)).not.toBeNull()
  })

  it('renders the chat vignette with its cited answer', () => {
    render(<ProductTour />)

    const chat = TOUR_VIGNETTES.find((vignette) => !vignette.line)
    fireEvent.click(screen.getByRole('tab', { name: chat!.chip }))

    expect(screen.getByText(TOUR_CHAT_EXCHANGE.question)).not.toBeNull()
    for (const citation of TOUR_CHAT_EXCHANGE.citations) {
      expect(screen.getByText(citation)).not.toBeNull()
    }
  })

  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<ProductTour />)

    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
