/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroMatchDemo } from './hero-match-demo'
import { DEMO_DOCS, DEMO_DWELL_MS, DEMO_SCANNING, DEMO_SCAN_MS } from '@/lib/landing-demo-docs'

// jsdom has no IntersectionObserver. useInView treats that as "visible", which
// is exactly the state the autoplay assertions need.
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

describe('HeroMatchDemo', () => {
  it('opens on the flagged line with its verdict already resolved', () => {
    render(<HeroMatchDemo />)

    const opening = DEMO_DOCS[0].lines[1]
    expect(screen.getByText(opening.text)).not.toBeNull()
    expect(screen.getByText(`src: ${opening.source}`)).not.toBeNull()
  })

  it('shows the real PO price while scanning but withholds catalog and confidence', () => {
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    const first = DEMO_DOCS[0].lines[0]
    fireEvent.click(screen.getByText(first.item))

    expect(screen.getByText(DEMO_SCANNING.text)).not.toBeNull()
    expect(screen.getByText(DEMO_SCANNING.source)).not.toBeNull()
    // PO price is read off the document, so it is known immediately.
    expect(screen.getAllByText(first.poPrice).length).toBeGreaterThan(0)
    // Catalog + confidence are still being looked up.
    expect(screen.getAllByText(DEMO_SCANNING.placeholder)).toHaveLength(2)
  })

  it('resolves a clicked line to its verdict after the scan window', () => {
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    const target = DEMO_DOCS[0].lines[2]
    fireEvent.click(screen.getByText(target.item))
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })

    expect(screen.getByText(target.text)).not.toBeNull()
    expect(screen.queryByText(DEMO_SCANNING.placeholder)).toBeNull()
  })

  it('advances to the next line on its own after the dwell', () => {
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    act(() => {
      vi.advanceTimersByTime(DEMO_DWELL_MS)
    })
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })

    expect(screen.getByText(DEMO_DOCS[0].lines[2].text)).not.toBeNull()
  })

  it('rolls over into the next document after the last line', () => {
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    // opening line index 1 -> 2 -> rolls to doc 1, line 0.
    // One act() per phase: each transition re-arms the timer from an effect,
    // so a single combined advance only lands the first hop.
    for (let hop = 0; hop < 2; hop += 1) {
      act(() => {
        vi.advanceTimersByTime(DEMO_DWELL_MS)
      })
      act(() => {
        vi.advanceTimersByTime(DEMO_SCAN_MS)
      })
    }

    expect(screen.getByText(DEMO_DOCS[1].lines[0].text)).not.toBeNull()
  })

  it('switching to the shorter document clamps the active line instead of crashing', () => {
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    // Go to the 4-line document and select its last line...
    fireEvent.click(screen.getByText(DEMO_DOCS[1].label))
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })
    fireEvent.click(screen.getByText(DEMO_DOCS[1].lines[3].item))
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })

    // ...then back to the 3-line one. Tab clicks reset to line 0.
    fireEvent.click(screen.getByText(DEMO_DOCS[0].label))
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })

    expect(screen.getByText(DEMO_DOCS[0].lines[0].text)).not.toBeNull()
  })

  it('marks the active document tab as pressed', () => {
    render(<HeroMatchDemo />)

    const tabs = DEMO_DOCS.map((doc) => screen.getByText(doc.label))
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true')
    expect(tabs[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('under reduced motion it does not autoplay and renders no sweep', () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    const { container } = render(<HeroMatchDemo />)

    act(() => {
      vi.advanceTimersByTime(DEMO_DWELL_MS * 3)
    })

    // Still on the line it opened with.
    expect(screen.getByText(DEMO_DOCS[0].lines[1].text)).not.toBeNull()
    expect(container.querySelector('.animate-rf-sweep')).toBeNull()
  })

  it('still resolves a manual pick to a verdict under reduced motion', () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    render(<HeroMatchDemo />)

    const target = DEMO_DOCS[0].lines[0]
    fireEvent.click(screen.getByText(target.item))
    act(() => {
      vi.advanceTimersByTime(DEMO_SCAN_MS)
    })

    expect(screen.getByText(target.text)).not.toBeNull()
  })

  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<HeroMatchDemo />)

    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
