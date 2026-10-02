/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RootLoading from './loading'

describe('RootLoading', () => {
  afterEach(() => {
    cleanup()
  })

  it('regression: drops "Preparing polished product shell." and the "Please wait" badge', () => {
    render(<RootLoading />)

    expect(screen.queryByText('Preparing polished product shell.')).toBeNull()
    expect(screen.queryByText('Please wait')).toBeNull()
  })

  it('regression: labels the shell silhouette with a Mono "Loading workspace…"', () => {
    render(<RootLoading />)

    expect(screen.getByText('Loading workspace…')).toBeTruthy()
  })

  it('happy: uses the Optra aperture brand mark in the sidebar silhouette', () => {
    const { container } = render(<RootLoading />)

    expect(container.querySelector('[data-brand-mark="optra-mark"]')).not.toBeNull()
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull()
  })
})
