/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FinalCta } from './final-cta'

afterEach(cleanup)

describe('FinalCta', () => {
  it('regression: no longer claims no card or self-serve deletion', () => {
    const { container } = render(<FinalCta />)

    expect(container.textContent).not.toMatch(/no card/i)
    expect(container.textContent).not.toMatch(/delete the workspace and every file goes with it/i)
  })

  // The old CTA promised a "live match demo" behind /chat, which only
  // redirects into an authenticated workspace.
  it('regression: does not link to /chat', () => {
    const { container } = render(<FinalCta />)

    expect(container.querySelectorAll('a[href="/chat"]')).toHaveLength(0)
  })

  it('happy: spells out the trial and the ask-and-we-delete promise', () => {
    render(<FinalCta />)

    expect(
      screen.getByText('14-day free trial · ask and we delete your workspace and every file'),
    ).not.toBeNull()
  })

  it('happy: renders under the #trial anchor every trial CTA points at', () => {
    const { container } = render(<FinalCta />)

    expect(container.querySelector('#trial')).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Check one purchase order tonight.' }),
    ).not.toBeNull()
  })

  it('happy: sends the primary action into the app and the secondary to the on-page tour', () => {
    render(<FinalCta />)

    expect(screen.getByRole('link', { name: /Start free trial/i }).getAttribute('href')).toBe(
      '/workspaces',
    )
    expect(screen.getByRole('link', { name: /See the match demo/i }).getAttribute('href')).toBe(
      '#tour',
    )
  })
})
