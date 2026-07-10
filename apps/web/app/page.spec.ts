/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// DotGrid renders a real <canvas> 2D context, which jsdom cannot provide
// (same reason Strands is mocked in thinking-indicator.spec.ts) -- mock it so
// the landing page's ambient background doesn't spam "not implemented"
// canvas errors on every test in this file.
vi.mock('@/components/DotGrid', () => ({
  default: () => React.createElement('div', { 'data-testid': 'dot-grid-mock' }),
}))

import Home from './page'

describe('Home', () => {
  it('routes landing page CTAs to workspaces and removes retired dashboard links', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelectorAll('a[href="/dashboard"]')).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Open workspace' }).getAttribute('href')).toBe('/workspaces')
    expect(screen.getByRole('link', { name: /Launch workspace/i }).getAttribute('href')).toBe('/workspaces')
    expect(screen.getByRole('link', { name: 'Explore workspace' }).getAttribute('href')).toBe('/workspaces')
  })

  it('gives the logo link an accessible Home label', () => {
    const { container } = render(React.createElement(Home))

    const logoLink = screen.getAllByRole('link', { name: 'Home' }).at(0)

    expect(logoLink?.getAttribute('href')).toBe('/')
    expect(logoLink?.querySelector('[data-brand-mark="optra-mark"]')).not.toBeNull()
    expect(container.querySelector('a[aria-label="Home"] svg.lucide-sparkles')).toBeNull()
  })

  it('renders product-focused copy and removes the flagged UI-process copy', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Match it once, not line by line').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ramp new buyers faster').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Matches your team can verify, not just trust').length).toBeGreaterThan(0)

    expect(screen.queryByText('Designed like real software, not placeholder screens')).toBeNull()
    expect(screen.queryByText('No jargon-heavy UI. No flashy motion overload. Just clear structure, helpful defaults, and enough polish to feel premium.')).toBeNull()
    expect(screen.queryByText('From blank state to production workflow, layout guides users with clear next actions instead of assuming technical fluency.')).toBeNull()
    expect(screen.queryByText('Users judge product quality before they read docs. Clean spacing, subtle motion, clear states, and premium surfaces increase trust immediately.')).toBeNull()
  })

  it('replaces stale dashboard copy with workspace section copy', () => {
    render(React.createElement(Home))

    expect(screen.queryAllByText('Dashboard surfaces empty states, onboarding checklist, and confidence-building feedback patterns.')).toHaveLength(0)
    expect(screen.getAllByText('Use it alone, or bring the whole procurement team').length).toBeGreaterThan(0)
  })

  it('keeps landing content icons visible while removing the colored-circle wrappers on the pillar cards', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByText('PO line item').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Match it once, not line by line').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ramp new buyers faster').length).toBeGreaterThan(0)

    expect(container.querySelector('svg.lucide-file-search.size-5.text-primary')).not.toBeNull()
    expect(container.querySelector('svg.lucide-search.size-5')).not.toBeNull()
    expect(container.querySelector('.rounded-2xl.bg-primary\\/10')).toBeNull()
  })

  it('gives the four anchor-linked sections a matching id so header/footer nav links actually resolve', () => {
    const { container } = render(React.createElement(Home))

    expect(container.querySelector('#product')).not.toBeNull()
    expect(container.querySelector('#workflow')).not.toBeNull()
    expect(container.querySelector('#use-cases')).not.toBeNull()
    expect(container.querySelector('#faq')).not.toBeNull()
  })

  it('renders the workflow step titles by name', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Connect your vendors').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Optra matches automatically').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Review what got flagged').length).toBeGreaterThan(0)
  })

  it('renders all six use-case persona strings by name', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Procurement teams').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AP / accounts payable teams').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Multi-vendor sourcing teams').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Operations & supply chain teams').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Small business buyers').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Founder-led purchasing workflows').length).toBeGreaterThan(0)
  })

  it('renders the hero match confidence as a real progressbar meter, not plain text', () => {
    render(React.createElement(Home))

    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0)
  })

  it('rewrites hero copy around the pain point instead of the feature, removing the old self-referential copy', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('The mismatch is already in the paperwork.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Optra helps you catch it before you pay.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Match purchase orders against vendor catalogs/).length).toBeGreaterThan(0)

    expect(screen.queryByText('Give every support teammate')).toBeNull()
    expect(screen.queryByText('expert-level context')).toBeNull()
    expect(screen.queryByText('Mnemra turns scattered documentation into fast, confident answers. It looks polished, feels easy, and helps non-technical teams solve customer issues without digging through tabs.')).toBeNull()
  })

  it('rewrites the pillars section title away from the retired UI-process framing', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Stop approving invoices you have not actually checked').length).toBeGreaterThan(0)
    expect(screen.queryByText('Fast answers for people who just need system to work')).toBeNull()
  })

  it('adds a workspaces section supporting both solo and team use as an interactive switcher', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByText('Use it alone, or bring the whole procurement team').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('tab', { name: /Personal/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('tab', { name: /Team/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Your own purchasing memory').length).toBeGreaterThan(0)

    expect(container.querySelector('svg.lucide-user')).not.toBeNull()
    expect(container.querySelector('svg.lucide-users')).not.toBeNull()
  })

  it('rewrites the final CTA to not re-narrow to teams-only after the solo/team section', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Ready to check your first purchase order?').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ready to turn support knowledge into product advantage?')).toBeNull()
  })

  it('embeds Organization + SoftwareApplication JSON-LD structured data', () => {
    const { container } = render(React.createElement(Home))

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()

    const parsed = JSON.parse(script?.textContent ?? '[]')
    const org = parsed.find((entry: { '@type': string }) => entry['@type'] === 'Organization')
    const app = parsed.find((entry: { '@type': string }) => entry['@type'] === 'SoftwareApplication')

    expect(org).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Optra',
      url: 'https://optra.example.com',
    })
    expect(app).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Optra',
      applicationCategory: 'BusinessApplication',
      description: 'Match purchase orders against vendor catalogs and invoices, with vision-based product matching and automatic discrepancy flagging.',
    })
  })
})
