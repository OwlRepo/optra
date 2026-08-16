/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, REVEAL_FALLBACK_MS, useInView } from './use-in-view'

function Probe() {
  const { ref, inView } = useInView<HTMLDivElement>()
  return <div ref={ref}>{inView ? 'in-view' : 'not-in-view'}</div>
}

describe('useInView', () => {
  afterEach(() => {
    // This file has no global auto-cleanup; without an explicit cleanup the
    // probes from earlier cases stay mounted and getByText matches several.
    cleanup()
    vi.unstubAllGlobals()
  })

  it('reports in-view immediately when IntersectionObserver is unavailable', () => {
    render(<Probe />)

    expect(screen.getByText('in-view')).not.toBeNull()
  })

  it('reveals anyway if the observer is present but never fires', () => {
    vi.useFakeTimers()

    class SilentIntersectionObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    }

    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver)

    render(<Probe />)
    expect(screen.getByText('not-in-view')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(REVEAL_FALLBACK_MS)
    })

    expect(screen.getByText('in-view')).not.toBeNull()
    vi.useRealTimers()
  })

  it('waits for an intersecting entry when IntersectionObserver is available', () => {
    let capturedCallback: IntersectionObserverCallback = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()

    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        capturedCallback = callback
      }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

    render(<Probe />)

    expect(screen.getByText('not-in-view')).not.toBeNull()
    expect(observe).toHaveBeenCalledTimes(1)

    // Wrapped in act so the resulting setState is flushed before asserting.
    act(() => {
      capturedCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(screen.getByText('in-view')).not.toBeNull()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('prefersReducedMotion', () => {
  afterEach(() => {
    // This file has no global auto-cleanup; without an explicit cleanup the
    // probes from earlier cases stay mounted and getByText matches several.
    cleanup()
    vi.unstubAllGlobals()
  })

  it('returns false when matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reflects the prefers-reduced-motion media query result', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    expect(prefersReducedMotion()).toBe(true)
  })
})
