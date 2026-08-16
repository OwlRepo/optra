/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Home from './page'

afterEach(cleanup)

describe('Home', () => {
  it('renders every in-page anchor target the nav and footer link to', () => {
    const { container } = render(React.createElement(Home))

    for (const id of ['product', 'workflow', 'pricing', 'faq', 'trial', 'tour']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull()
    }
  })

  it('does not link to the retired dashboard route', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelectorAll('a[href="/dashboard"]')).toHaveLength(0)
  })

  it('no longer sends visitors to /chat, which only redirects into an authed workspace', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelectorAll('a[href="/chat"]')).toHaveLength(0)
  })

  it('points the primary trial CTAs at the trial anchor', () => {
    const { container } = render(React.createElement(Home))

    // nav + hero + three pricing plan CTAs
    expect(container.querySelectorAll('a[href="#trial"]').length).toBeGreaterThanOrEqual(5)
  })

  it('gives the logo link an accessible Home label and renders the brand mark', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByRole('link', { name: 'Home' }).at(0)).not.toBeUndefined()
    expect(container.querySelector('[data-brand-mark]')).not.toBeNull()
  })

  it('emits Organization and SoftwareApplication JSON-LD', () => {
    const { container } = render(React.createElement(Home))

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()

    const parsed = JSON.parse(script?.innerHTML ?? '[]')
    expect(parsed.map((entry: { '@type': string }) => entry['@type'])).toEqual([
      'Organization',
      'SoftwareApplication',
    ])
  })

  it('renders the hero headline and the single conversion goal', () => {
    render(React.createElement(Home))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Catch the mismatch')
    expect(screen.getAllByRole('link', { name: /start free trial/i }).length).toBeGreaterThan(0)
  })

  it('keeps the illustrative-figures disclaimers next to the placeholder metrics', () => {
    render(React.createElement(Home))

    expect(screen.getByText(/Illustrative figures from internal test runs/i)).not.toBeNull()
    expect(screen.getByText(/illustrative examples, not customer results/i)).not.toBeNull()
  })

  it('renders the comparison table with both column headings', () => {
    render(React.createElement(Home))

    expect(screen.getByText('Today, by hand')).not.toBeNull()
    expect(screen.getByText('With Optra')).not.toBeNull()
  })

  it('renders the FAQ with the first item expanded', () => {
    render(React.createElement(Home))

    const collapsed = screen.queryAllByRole('button', { expanded: false })
    const expanded = screen.queryAllByRole('button', { expanded: true })

    expect(collapsed.length + expanded.length).toBeGreaterThanOrEqual(5)
    expect(expanded.length).toBeGreaterThanOrEqual(1)
  })

  it('renders the three pricing plans', () => {
    render(React.createElement(Home))

    // Scoped to headings: "Team" is also the label of the workspace-mode tab.
    expect(screen.getByRole('heading', { name: 'Solo' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Team' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Scale' })).not.toBeNull()
  })
})
