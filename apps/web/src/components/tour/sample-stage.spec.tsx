/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SampleStage, type SampleStageProps } from './sample-stage'
import { TOUR_ANCHORS, tourSelector } from './tour-anchors'

const SAMPLE_LABEL = 'Sample data — not your workspace'

let fetchSpy: ReturnType<typeof vi.fn>

function setup(props: Partial<SampleStageProps> = {}) {
  const callbacks = { onRunComplete: vi.fn(), onFlagOpened: vi.fn(), onVerified: vi.fn() }
  const view = render(<SampleStage section="compare" {...callbacks} {...props} />)
  return { ...callbacks, ...view }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function bySelector(id: (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS]) {
  return document.querySelector(tourSelector(id))
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchSpy = vi.fn().mockRejectedValue(new Error('network must not be used'))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SampleStage', () => {
  it('error: never calls fetch through the whole compare and photo flow', () => {
    const compare = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    advance(3000)
    fireEvent.click(screen.getByRole('button', { name: 'Review sample price flag' }))
    compare.unmount()

    setup({ section: 'photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify match' }))
    advance(2000)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('error: unmounting mid-run clears timers so no callback fires afterwards', () => {
    const { unmount, onRunComplete } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    advance(500)

    unmount()
    advance(5000)

    expect(onRunComplete).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('error: unmounting mid-verify clears timers so onVerified never fires', () => {
    const { unmount, onVerified } = setup({ section: 'photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify match' }))
    advance(300)

    unmount()
    advance(5000)

    expect(onVerified).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('edge: reducedMotion shows results synchronously and calls onRunComplete without timers', () => {
    const { onRunComplete } = setup({ reducedMotion: true })

    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    expect(onRunComplete).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Review sample price flag' })).toBeDefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('edge: reducedMotion verify shows the Match badge synchronously', () => {
    const { onVerified } = setup({ section: 'photo', reducedMotion: true })

    fireEvent.click(screen.getByRole('button', { name: 'Verify match' }))

    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(bySelector(TOUR_ANCHORS.sampleMatch)).not.toBeNull()
  })

  it('edge: before Run is tapped there are no results and no callbacks', () => {
    const { onRunComplete, onFlagOpened, onVerified } = setup()

    expect(screen.queryByRole('button', { name: 'Review sample price flag' })).toBeNull()
    expect(onRunComplete).not.toHaveBeenCalled()
    expect(onFlagOpened).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('edge: before Verify is tapped there is no Match badge', () => {
    setup({ section: 'photo' })
    expect(bySelector(TOUR_ANCHORS.sampleMatch)).toBeNull()
  })

  it.each(['compare', 'photo'] as const)('regression: the "%s" section always shows the sample label', (section) => {
    setup({ section })
    expect(screen.getAllByText(SAMPLE_LABEL).length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Sample comparison' })).toBeDefined()
  })

  it('regression: the sample label stays after results and after the flag opens', () => {
    setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review sample price flag' }))
    expect(screen.getAllByText(SAMPLE_LABEL).length).toBeGreaterThan(0)
  })

  it('happy: Run comparison shows progress, then three result rows and fires onRunComplete', () => {
    const { onRunComplete } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    expect(screen.getByText('Comparing')).toBeDefined()
    expect(onRunComplete).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Review sample price flag' })).toBeNull()

    advance(3000)

    // 1 header row + 3 result rows.
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText('Matched')).toBeDefined()
    expect(onRunComplete).toHaveBeenCalledTimes(1)
  })

  it('happy: tapping the price flag shows PO, invoice and receipt citations and fires onFlagOpened', () => {
    const { onFlagOpened } = setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    fireEvent.click(screen.getByRole('button', { name: 'Review sample price flag' }))

    const citations = bySelector(TOUR_ANCHORS.sampleCitations)
    expect(citations).not.toBeNull()
    const text = citations?.textContent ?? ''
    expect(text).toMatch(/PO line/i)
    expect(text).toMatch(/row 4/)
    expect(text).toMatch(/invoice/i)
    expect(text).toMatch(/p\.1/)
    expect(text).toMatch(/line 3/)
    expect(text).toMatch(/receipt/i)
    expect(text).toMatch(/line 2/)
    expect(onFlagOpened).toHaveBeenCalledTimes(1)
  })

  it('happy: Verify match fills the meter then shows the Match badge and fires onVerified', () => {
    const { onVerified } = setup({ section: 'photo' })

    fireEvent.click(screen.getByRole('button', { name: 'Verify match' }))
    expect(onVerified).not.toHaveBeenCalled()
    expect(bySelector(TOUR_ANCHORS.sampleMatch)).toBeNull()

    advance(1500)

    expect(bySelector(TOUR_ANCHORS.sampleMatch)).not.toBeNull()
    expect(onVerified).toHaveBeenCalledTimes(1)
  })
})
