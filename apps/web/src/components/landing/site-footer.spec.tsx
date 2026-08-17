/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SiteFooter } from './site-footer'

afterEach(cleanup)

describe('SiteFooter', () => {
  it('groups links under three labelled navs', () => {
    render(<SiteFooter />)

    for (const heading of ['Product', 'Company', 'App']) {
      expect(screen.getByRole('navigation', { name: heading })).not.toBeNull()
      expect(screen.getByRole('heading', { name: heading })).not.toBeNull()
    }
  })

  it('resolves every link to a real destination', () => {
    render(<SiteFooter />)

    const expected = {
      Matching: '#product',
      Workflow: '#workflow',
      Pricing: '#pricing',
      FAQ: '#faq',
      'A look inside': '#tour',
      Workspace: '/workspaces',
      'Sign in': '/login',
    }

    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
    }
  })

  // The old footer sent "Live demo" to /chat, which only redirects into an
  // authenticated workspace -- an overpromise to logged-out visitors.
  it('does not link to /chat', () => {
    const { container } = render(<SiteFooter />)

    expect(container.querySelectorAll('a[href="/chat"]')).toHaveLength(0)
  })

  it('keeps the illustrative-results disclaimer in the bottom bar', () => {
    render(<SiteFooter />)

    expect(
      screen.getByText('Figures on this page are illustrative examples, not customer results.'),
    ).not.toBeNull()
    expect(screen.getByText('© 2026 Optra. All rights reserved.')).not.toBeNull()
  })
})
