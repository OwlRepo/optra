/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './brand-mark'

describe('BrandMark', () => {
  it('renders the Optra aperture SVG by default', () => {
    const { container } = render(<BrandMark />)

    const mark = container.querySelector('[data-brand-mark="optra-mark"]')
    const image = screen.getByAltText('Optra logo') as HTMLImageElement

    expect(mark).not.toBeNull()
    expect(image.getAttribute('src')).toBe('/optra-mark.svg')
  })

  it('can be decorative inside already-labelled links', () => {
    const { container } = render(<BrandMark decorative />)

    const image = container.querySelector('img')

    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('aria-hidden')).toBe('true')
  })
})
