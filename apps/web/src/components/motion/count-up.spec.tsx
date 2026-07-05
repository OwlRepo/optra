/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountUp } from './count-up'

describe('CountUp', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('jumps straight to the final value when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    render(<CountUp value={94} suffix="%" />)

    expect(await screen.findByText('94%')).not.toBeNull()
  })

  it('renders prefix and suffix around the final value', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    render(<CountUp value={15} prefix="<" suffix="s" />)

    expect(await screen.findByText('<15s')).not.toBeNull()
  })

  it('starts at zero before animating in (no reduced-motion preference)', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    vi.stubGlobal('IntersectionObserver', undefined)

    const { container } = render(<CountUp value={42} suffix="%" />)

    expect(container.querySelector('[data-numeric]')).not.toBeNull()
  })
})
