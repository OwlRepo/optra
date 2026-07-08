/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStickToBottom } from './use-stick-to-bottom'

function TestHarness({
  onRender,
}: {
  onRender: (api: ReturnType<typeof useStickToBottom<HTMLDivElement>>) => void
}) {
  const api = useStickToBottom<HTMLDivElement>()
  onRender(api)
  return React.createElement('div', { ref: api.containerRef, 'data-testid': 'scroller' })
}

function setScrollMetrics(
  el: HTMLElement,
  { scrollHeight, scrollTop, clientHeight }: { scrollHeight: number; scrollTop: number; clientHeight: number },
) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('useStickToBottom', () => {
  afterEach(() => {
    cleanup()
  })

  it('starts near-bottom by default', () => {
    let latest: ReturnType<typeof useStickToBottom<HTMLDivElement>> | undefined
    render(React.createElement(TestHarness, { onRender: (api) => (latest = api) }))
    expect(latest?.isNearBottom).toBe(true)
  })

  it('flips to not-near-bottom when scrolled away, then back true after scrollToBottom', () => {
    let latest: ReturnType<typeof useStickToBottom<HTMLDivElement>> | undefined
    const { getByTestId } = render(React.createElement(TestHarness, { onRender: (api) => (latest = api) }))
    const scroller = getByTestId('scroller')
    scroller.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      Object.defineProperty(scroller, 'scrollTop', { value: top, configurable: true })
    }) as unknown as typeof scroller.scrollTo

    setScrollMetrics(scroller, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 })
    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(latest?.isNearBottom).toBe(false)

    act(() => {
      latest?.scrollToBottom('auto')
    })
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'auto' })
    expect(latest?.isNearBottom).toBe(true)
  })

  it('treats a position within the bottom threshold as near-bottom', () => {
    let latest: ReturnType<typeof useStickToBottom<HTMLDivElement>> | undefined
    const { getByTestId } = render(React.createElement(TestHarness, { onRender: (api) => (latest = api) }))
    const scroller = getByTestId('scroller')
    setScrollMetrics(scroller, { scrollHeight: 1000, scrollTop: 950, clientHeight: 500 })

    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(latest?.isNearBottom).toBe(true)
  })
})
