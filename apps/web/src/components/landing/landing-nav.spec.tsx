/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LandingNav } from './landing-nav'

afterEach(cleanup)

describe('LandingNav', () => {
  it('links each nav item to its in-page section', () => {
    render(<LandingNav />)

    const expected = {
      Product: '#product',
      Workflow: '#workflow',
      Pricing: '#pricing',
      FAQ: '#faq',
    }

    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
    }
  })

  it('gives the brand link an accessible Home label and the shared mark', () => {
    const { container } = render(<LandingNav />)

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    expect(container.querySelector('[data-brand-mark]')).not.toBeNull()
  })

  it('renders one primary CTA aimed at the trial anchor', () => {
    render(<LandingNav />)

    expect(screen.getByRole('link', { name: 'Start free trial' }).getAttribute('href')).toBe(
      '#trial',
    )
  })

  it('stays sticky so the CTA follows the reader down the page', () => {
    const { container } = render(<LandingNav />)

    expect(container.querySelector('header')?.className).toContain('sticky')
  })
})
