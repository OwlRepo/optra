/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../DotGrid', () => ({
  // DotGrid renders real <canvas> + WebGL-adjacent 2D context calls, which
  // jsdom cannot provide (same reason Strands.tsx is mocked in
  // thinking-indicator.spec.ts) — mock it so this spec exercises only
  // AmbientDotGrid's own reduced-motion gating logic.
  default: () => <div data-testid="dot-grid-mock" />,
}))

import { AmbientDotGrid } from './ambient-dot-grid'

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

describe('AmbientDotGrid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the static fallback when prefers-reduced-motion is set', async () => {
    stubReducedMotion(true)
    render(<AmbientDotGrid />)
    expect(await screen.findByTestId('ambient-dot-grid-static')).not.toBeNull()
    expect(screen.queryByTestId('dot-grid-mock')).toBeNull()
  })

  it('swaps to the live dot grid when reduced motion is not requested', async () => {
    stubReducedMotion(false)
    render(<AmbientDotGrid />)
    expect(await screen.findByTestId('dot-grid-mock')).not.toBeNull()
  })
})
