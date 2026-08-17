/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Hero } from './hero'

afterEach(cleanup)

describe('Hero', () => {
  it('renders the headline with its deliberate line break', () => {
    const { container } = render(<Hero />)

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Catch the mismatchbefore you pay it.')
    expect(container.querySelector('h1 br')).not.toBeNull()
  })

  it('offers one primary CTA and one secondary, not a wall of choices', () => {
    render(<Hero />)

    expect(screen.getByRole('link', { name: /Start free trial/i }).getAttribute('href')).toBe(
      '#trial',
    )
    expect(screen.getByRole('link', { name: 'See how matching works' }).getAttribute('href')).toBe(
      '#product',
    )
  })

  it('states the no-commitment reassurance under the buttons', () => {
    render(<Hero />)

    expect(
      screen.getByText('14 days free · no card · works with the PDFs you already have'),
    ).not.toBeNull()
  })

  it('mounts the interactive match demo alongside the copy', () => {
    render(<Hero />)

    // The demo owns the document tabs; their presence proves it rendered.
    expect(screen.getByText('PO #4417 · Ironclad')).not.toBeNull()
    expect(screen.getByText('Catalog evidence')).not.toBeNull()
  })
})
