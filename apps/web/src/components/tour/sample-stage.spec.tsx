/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SampleStage, type SampleStageProps } from './sample-stage'
import { SAMPLE_CURRENCY, SAMPLE_MATCHED_LINE } from './sample-scenario'
import { TOUR_ANCHORS, tourSelector } from './tour-anchors'

const SAMPLE_LABEL = 'Sample data — not your workspace'

let fetchSpy: ReturnType<typeof vi.fn>

function setup(props: Partial<SampleStageProps> = {}) {
  const callbacks = { onRunComplete: vi.fn(), onFlagOpened: vi.fn(), onVerified: vi.fn(), onActionsReady: vi.fn() }
  const view = render(<SampleStage section="compare" {...callbacks} {...props} />)
  return { ...callbacks, ...view }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

type Actions = { run: () => void; openFlag: () => void; verify: () => void }

function actionsOf(onActionsReady: ReturnType<typeof vi.fn>): Actions {
  const calls = onActionsReady.mock.calls.filter((call) => call[0] !== null)
  return calls[calls.length - 1][0] as Actions
}

function liveRegion(): HTMLElement {
  const region = screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'))
  if (!region) throw new Error('no sr-only role=status live region')
  return region
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

  it('error: openFlag before the results are visible does nothing', () => {
    const { onFlagOpened, onActionsReady } = setup({ reducedMotion: true })

    act(() => actionsOf(onActionsReady).openFlag())

    expect(onFlagOpened).not.toHaveBeenCalled()
    expect(bySelector(TOUR_ANCHORS.sampleCitations)).toBeNull()
  })

  it('error: onActionsReady is cleared with null on unmount', () => {
    const { onActionsReady, unmount } = setup()
    unmount()
    expect(onActionsReady.mock.calls[onActionsReady.mock.calls.length - 1][0]).toBeNull()
  })

  it('edge: the exposed actions do exactly what clicking the controls does', () => {
    const { onRunComplete, onFlagOpened, onActionsReady } = setup({ reducedMotion: true })

    act(() => actionsOf(onActionsReady).run())
    expect(onRunComplete).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Review sample price flag' })).toBeDefined()

    act(() => actionsOf(onActionsReady).openFlag())
    expect(onFlagOpened).toHaveBeenCalledTimes(1)
    expect(bySelector(TOUR_ANCHORS.sampleCitations)).not.toBeNull()
  })

  it('edge: the exposed verify action fills the meter and fires onVerified', () => {
    const { onVerified, onActionsReady } = setup({ section: 'photo', reducedMotion: true })

    act(() => actionsOf(onActionsReady).verify())

    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(bySelector(TOUR_ANCHORS.sampleMatch)).not.toBeNull()
  })

  it('edge: the matched row takes its numbers from the sample scenario', () => {
    setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    const row = screen.getByText('Matched').closest('tr') as HTMLElement
    const cells = Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent)

    expect(cells).toContain(SAMPLE_MATCHED_LINE.ordered)
    expect(cells).toContain(SAMPLE_MATCHED_LINE.billed)
    expect(cells).toContain(SAMPLE_MATCHED_LINE.delta)
  })

  it('edge: money values show their currency in mono, quantities do not', () => {
    setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review sample price flag' }))

    const table = screen.getByRole('table')
    const priceRow = within(table).getByText('Price mismatch').closest('tr') as HTMLElement
    expect(priceRow.textContent).toMatch(new RegExp(`0\\.42\\s*${SAMPLE_CURRENCY}`))
    expect(priceRow.textContent).toMatch(new RegExp(`0\\.47\\s*${SAMPLE_CURRENCY}`))
    expect(priceRow.querySelector('.font-mono')).not.toBeNull()
    const shortRow = within(table).getByText('Short receipt').closest('tr') as HTMLElement
    expect(shortRow.textContent).not.toContain(SAMPLE_CURRENCY)
    const citations = bySelector(TOUR_ANCHORS.sampleCitations)?.textContent ?? ''
    expect(citations).toMatch(new RegExp(`0\\.42\\s*${SAMPLE_CURRENCY}`))
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
    expect(screen.getByRole('region', { name: /sample data/i })).toBeDefined()
  })

  it('regression: no arbitrary 6px radius is left on the stage', () => {
    const { container } = setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    expect(container.innerHTML).not.toContain('rounded-[6px]')
  })

  it('regression: the sample label stays after results and after the flag opens', () => {
    setup({ reducedMotion: true })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review sample price flag' }))
    expect(screen.getAllByText(SAMPLE_LABEL).length).toBeGreaterThan(0)
  })

  it('happy: the live region announces comparing, complete and verified', () => {
    setup()
    expect(liveRegion().textContent).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    expect(liveRegion().textContent).toMatch(/comparing/i)
    advance(3000)
    expect(liveRegion().textContent).toMatch(/comparison complete/i)
  })

  it('happy: the live region announces a verified match', () => {
    setup({ section: 'photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify match' }))
    advance(1500)
    expect(liveRegion().textContent).toMatch(/match verified/i)
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
