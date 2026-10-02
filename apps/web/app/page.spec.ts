/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Home from './page'

afterEach(cleanup)

describe('Home', () => {
  it('happy: renders every in-page anchor target the nav and footer link to', () => {
    const { container } = render(React.createElement(Home))

    for (const id of ['product', 'workflow', 'pricing', 'faq', 'trial', 'tour']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull()
    }
  })

  it('happy: does not link to the retired dashboard route', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelectorAll('a[href="/dashboard"]')).toHaveLength(0)
  })

  it('happy: no longer sends visitors to /chat, which only redirects into an authed workspace', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelectorAll('a[href="/chat"]')).toHaveLength(0)
  })

  it('happy: points the primary trial CTAs at the trial anchor', () => {
    const { container } = render(React.createElement(Home))

    // nav + hero + Solo and Team plan CTAs (Scale is a mailto)
    expect(container.querySelectorAll('a[href="#trial"]').length).toBeGreaterThanOrEqual(4)
  })

  it('happy: gives the logo link an accessible Home label and renders the brand mark', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByRole('link', { name: 'Home' }).at(0)).not.toBeUndefined()
    expect(container.querySelector('[data-brand-mark]')).not.toBeNull()
  })

  it('happy: emits Organization and SoftwareApplication JSON-LD', () => {
    const { container } = render(React.createElement(Home))

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()

    const parsed = JSON.parse(script?.innerHTML ?? '[]')
    expect(parsed.map((entry: { '@type': string }) => entry['@type'])).toEqual([
      'Organization',
      'SoftwareApplication',
    ])
  })

  it('happy: renders the hero headline and the single conversion goal', () => {
    render(React.createElement(Home))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Catch the mismatch')
    expect(screen.getAllByRole('link', { name: /start free trial/i }).length).toBeGreaterThan(0)
  })

  it('regression: drops the illustrative-figures disclaimers and the invented metrics', () => {
    const { container } = render(React.createElement(Home))

    expect(container.textContent).not.toMatch(/Illustrative figures from internal test runs/i)
    expect(container.textContent).not.toMatch(/illustrative examples, not customer results/i)
    expect(container.textContent).not.toContain('94%')
  })

  it('regression: FAQ no longer claims image uploads are readable', () => {
    const { container } = render(React.createElement(Home))

    expect(container.textContent).not.toContain('or image')
    expect(container.textContent).not.toMatch(/price lists — PDF/)
    expect(container.textContent).not.toContain('files, matches and history within 30 days')
  })

  it('happy: keeps the sample-data disclaimer in the footer', () => {
    render(React.createElement(Home))

    expect(screen.getByText('Product screens on this page show sample data.')).not.toBeNull()
  })

  it('happy: FAQ discloses the OpenAI subprocessor and the 30-day deletion promise', () => {
    const { container } = render(React.createElement(Home))

    expect(container.textContent).toContain("OpenAI's API, which does not train on them")
    expect(container.textContent).toContain(
      'Email us and we delete your workspace data, including uploaded files, within 30 days. Backups expire on the schedule in the privacy policy.',
    )
    expect(container.textContent).toContain(
      'Vendor catalogs with product photos, purchase orders and invoices as PDF (scanned too), CSV or XLSX, and goods receipts as CSV or XLSX.',
    )
  })

  it('happy: renders the comparison table with both column headings', () => {
    render(React.createElement(Home))

    expect(screen.getByText('Today, by hand')).not.toBeNull()
    expect(screen.getByText('With Optra')).not.toBeNull()
  })

  it('happy: renders the FAQ with the first item expanded', () => {
    render(React.createElement(Home))

    const collapsed = screen.queryAllByRole('button', { expanded: false })
    const expanded = screen.queryAllByRole('button', { expanded: true })

    expect(collapsed.length + expanded.length).toBeGreaterThanOrEqual(5)
    expect(expanded.length).toBeGreaterThanOrEqual(1)
  })

  it('happy: renders the three pricing plans', () => {
    render(React.createElement(Home))

    // Scoped to headings: "Team" is also the label of the workspace-mode tab.
    expect(screen.getByRole('heading', { name: 'Solo' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Team' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Scale' })).not.toBeNull()
  })
})
