/** @vitest-environment jsdom */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
    expect(logoLink?.querySelector('[data-brand-mark="mnemra-bloom"]')).not.toBeNull()
    expect(container.querySelector('a[aria-label="Home"] svg.lucide-sparkles')).toBeNull()
  })

  it('renders product-focused copy and removes the flagged UI-process copy', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Search once, not everywhere').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ramp new agents faster').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Answers your team can verify, not just trust').length).toBeGreaterThan(0)

    expect(screen.queryByText('Designed like real software, not placeholder screens')).toBeNull()
    expect(screen.queryByText('No jargon-heavy UI. No flashy motion overload. Just clear structure, helpful defaults, and enough polish to feel premium.')).toBeNull()
    expect(screen.queryByText('From blank state to production workflow, layout guides users with clear next actions instead of assuming technical fluency.')).toBeNull()
    expect(screen.queryByText('Users judge product quality before they read docs. Clean spacing, subtle motion, clear states, and premium surfaces increase trust immediately.')).toBeNull()
  })

  it('replaces stale dashboard copy with workspace section copy', () => {
    render(React.createElement(Home))

    expect(screen.queryAllByText('Dashboard surfaces empty states, onboarding checklist, and confidence-building feedback patterns.')).toHaveLength(0)
    expect(screen.getAllByText('Use it alone, or bring the whole team').length).toBeGreaterThan(0)
  })

  it('keeps landing content icons visible while removing the colored-circle wrappers on the pillar cards', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByText('Agent question').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Search once, not everywhere').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ramp new agents faster').length).toBeGreaterThan(0)

    expect(container.querySelector('svg.lucide-message-square-text.size-5.text-primary')).not.toBeNull()
    expect(container.querySelector('svg.lucide-search.size-5')).not.toBeNull()
  })

  it('rewrites hero copy around the pain point instead of the feature, removing the old self-referential copy', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Your team already solved this.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mnemra helps you find it.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Search past tickets, docs, and support threads/).length).toBeGreaterThan(0)

    expect(screen.queryByText('Give every support teammate')).toBeNull()
    expect(screen.queryByText('expert-level context')).toBeNull()
    expect(screen.queryByText('Mnemra turns scattered documentation into fast, confident answers. It looks polished, feels easy, and helps non-technical teams solve customer issues without digging through tabs.')).toBeNull()
  })

  it('rewrites the pillars section title away from the retired UI-process framing', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Stop losing time to knowledge you already have').length).toBeGreaterThan(0)
    expect(screen.queryByText('Fast answers for people who just need system to work')).toBeNull()
  })

  it('adds a workspaces section supporting both solo and team use', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByText('Use it alone, or bring the whole team').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Personal workspace').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Team workspace').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/For VAs, freelancers, and solo support agents/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/For support teams and agencies/).length).toBeGreaterThan(0)

    expect(container.querySelector('svg.lucide-user.size-5')).not.toBeNull()
    expect(container.querySelector('svg.lucide-users.size-5')).not.toBeNull()
  })

  it('rewrites the final CTA to not re-narrow to teams-only after the solo/team section', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Ready to build your support memory?').length).toBeGreaterThan(0)
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
      name: 'Mnemra',
      url: 'https://mnemra.tyvera.app',
    })
    expect(app).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Mnemra',
      applicationCategory: 'BusinessApplication',
      description: 'Search past tickets, docs, and support threads to get sourced answers before replying to customers.',
    })
  })
})
