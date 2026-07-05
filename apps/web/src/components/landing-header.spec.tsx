/** @vitest-environment jsdom */

import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LandingHeader } from './landing-header'

describe('LandingHeader', () => {
  it('renders the underlying AppHeader title', () => {
    const { getByText } = render(<LandingHeader title="Mnemra" />)

    expect(getByText('Mnemra')).not.toBeNull()
  })

  it('adds a stronger shadow once the page has scrolled', () => {
    const { container } = render(<LandingHeader title="Mnemra" />)
    const header = container.querySelector('header') as HTMLElement

    expect(header.className).toContain('shadow-sm')

    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true })
    fireEvent.scroll(window)

    expect(header.className).toContain('shadow-lg')
  })
})
