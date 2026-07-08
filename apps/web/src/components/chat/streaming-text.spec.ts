/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../SplitText', () => ({
  default: ({ text }: { text: string }) =>
    React.createElement('span', { 'data-split-chunk': true }, text),
}))

import { StreamingText } from './streaming-text'

describe('StreamingText', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders plain text with no chunk bookkeeping when inactive', () => {
    const { container } = render(React.createElement(StreamingText, { text: 'Hello world', active: false }))
    expect(container.textContent).toBe('Hello world')
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(0)
  })

  it('adds one chunk per growth in the streamed text while active', async () => {
    const { container, rerender } = render(React.createElement(StreamingText, { text: 'Hello', active: true }))
    await act(async () => {})
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(1)
    expect(container.textContent).toBe('Hello')

    rerender(React.createElement(StreamingText, { text: 'Hello world', active: true }))
    await act(async () => {})
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(2)
    expect(container.textContent).toBe('Hello world')
  })

  it('does not re-chunk already-rendered text on an unrelated re-render', async () => {
    const { container, rerender } = render(React.createElement(StreamingText, { text: 'Hi', active: true }))
    await act(async () => {})
    rerender(React.createElement(StreamingText, { text: 'Hi', active: true, className: 'foo' }))
    await act(async () => {})
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(1)
  })

  it('restarts chunking when the text shrinks (a new message started)', async () => {
    const { container, rerender } = render(React.createElement(StreamingText, { text: 'Hello world', active: true }))
    await act(async () => {})
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(1)

    rerender(React.createElement(StreamingText, { text: 'New', active: true }))
    await act(async () => {})
    expect(container.querySelectorAll('[data-split-chunk]').length).toBe(1)
    expect(container.textContent).toBe('New')
  })
})
