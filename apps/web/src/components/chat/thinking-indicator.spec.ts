/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Strands renders real WebGL via `ogl`, which jsdom cannot provide; ShinyText
// drives a continuous rAF-based gradient via `motion/react`. Both are vendored
// (shadcn/reactbits) components -- this test only verifies OUR wiring (the
// label and the loader slot both render), not their internal animation.
vi.mock('../Strands', () => ({
  default: () => React.createElement('div', { 'data-testid': 'strands-mock' }),
}))
vi.mock('../ShinyText', () => ({
  default: ({ text }: { text: string }) => React.createElement('span', null, text),
}))

import { ThinkingIndicator } from './thinking-indicator'

describe('ThinkingIndicator', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the loader and the given label', () => {
    render(React.createElement(ThinkingIndicator, { label: 'Thinking…' }))
    expect(screen.getByTestId('strands-mock')).toBeTruthy()
    expect(screen.getByText('Thinking…')).toBeTruthy()
  })
})
