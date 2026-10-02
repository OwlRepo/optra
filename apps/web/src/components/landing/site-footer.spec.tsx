/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SiteFooter } from './site-footer'

afterEach(cleanup)

describe('SiteFooter', () => {
  it('error: no longer claims the page figures are illustrative customer results', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).not.toMatch(/Figures on this page are illustrative/i)
    expect(container.textContent).not.toMatch(/All rights reserved/i)
  })

  it('error: no footer link is a bare #hash that would break on legal pages', () => {
    const { container } = render(<SiteFooter />)
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))

    expect(hrefs.filter((href) => href?.startsWith('#'))).toEqual([])
  })

  // The old footer sent "Live demo" to /chat, which only redirects into an
  // authenticated workspace -- an overpromise to logged-out visitors.
  it('regression: does not link to /chat', () => {
    const { container } = render(<SiteFooter />)

    expect(container.querySelectorAll('a[href="/chat"]')).toHaveLength(0)
  })

  it('happy: groups links under labelled navs including Legal', () => {
    render(<SiteFooter />)

    for (const heading of ['Product', 'Company', 'Legal', 'App']) {
      expect(screen.getByRole('navigation', { name: heading })).not.toBeNull()
      expect(screen.getByRole('heading', { name: heading })).not.toBeNull()
    }
  })

  it('happy: resolves every link to a real destination, legal pages and contact included', () => {
    render(<SiteFooter />)

    const expected = {
      Matching: '/#product',
      Workflow: '/#workflow',
      Pricing: '/#pricing',
      FAQ: '/#faq',
      'A look inside': '/#tour',
      Terms: '/terms',
      Privacy: '/privacy',
      Refunds: '/refund',
      Contact: 'mailto:romeo@tyvera.app',
      Workspace: '/workspaces',
      'Sign in': '/login',
    }

    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
    }
  })

  it('happy: shows the seller line and the sample-data disclaimer in the bottom bar', () => {
    render(<SiteFooter />)

    expect(screen.getByText('© 2026 Romeo Angeles Jr. · Optra · Philippines')).not.toBeNull()
    expect(screen.getByText('Product screens on this page show sample data.')).not.toBeNull()
  })
})
