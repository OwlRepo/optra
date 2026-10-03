/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ options: null as null | { overlayColor: string } }))

vi.mock('react-joyride', () => ({
  Joyride: (props: { options: { overlayColor: string } }) => {
    captured.options = props.options
    return null
  },
}))

import TourRunner from './tour-runner'

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('style')
})

const render_ = () => render(<TourRunner run stepIndex={0} steps={[]} onEvent={vi.fn()} />)

describe('TourRunner theme', () => {
  it('edge: starting in dark mode uses the black 60% scrim', () => {
    document.documentElement.classList.add('dark')
    render_()
    expect(captured.options?.overlayColor).toBe('oklch(0 0 0 / 0.6)')
  })

  it('edge: toggling the theme while the tour runs re-resolves the overlay', async () => {
    document.documentElement.style.setProperty('--foreground', 'oklch(0.238 0.03 264)')
    render_()
    expect(captured.options?.overlayColor).toBe('oklch(0.238 0.03 264 / 0.4)')

    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })

    expect(captured.options?.overlayColor).toBe('oklch(0 0 0 / 0.6)')
  })
})
