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
    render(React.createElement(Home))

    expect(screen.getAllByRole('link', { name: 'Home' }).at(0)?.getAttribute('href')).toBe('/')
  })

  it('renders product-focused copy and removes the flagged UI-process copy', () => {
    render(React.createElement(Home))

    expect(screen.getAllByText('Knowledge search, grounded chat, and ticket drafts all pull from the same source of truth, so answers never fall out of sync with your docs.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Support teammates get consistent, cited answers without learning a new tool or waiting on engineering.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Every answer cites its source, so agents can double-check before they reply and never guess in front of a customer.').length).toBeGreaterThan(0)

    expect(screen.queryByText('Designed like real software, not placeholder screens')).toBeNull()
    expect(screen.queryByText('No jargon-heavy UI. No flashy motion overload. Just clear structure, helpful defaults, and enough polish to feel premium.')).toBeNull()
    expect(screen.queryByText('From blank state to production workflow, layout guides users with clear next actions instead of assuming technical fluency.')).toBeNull()
    expect(screen.queryByText('Users judge product quality before they read docs. Clean spacing, subtle motion, clear states, and premium surfaces increase trust immediately.')).toBeNull()
  })

  it('replaces stale dashboard copy with workspace overview copy', () => {
    render(React.createElement(Home))

    expect(screen.queryAllByText('Dashboard surfaces empty states, onboarding checklist, and confidence-building feedback patterns.')).toHaveLength(0)
    expect(screen.getAllByText('Workspace overview surfaces empty states, onboarding checklist, and confidence-building feedback patterns.').length).toBeGreaterThan(0)
  })

  it('keeps landing content icons visible while removing the colored-circle wrappers', () => {
    const { container } = render(React.createElement(Home))

    expect(screen.getAllByText('Agent question').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Find right answer instantly').length).toBeGreaterThan(0)
    expect(screen.getAllByText('One place for support context').length).toBeGreaterThan(0)

    expect(container.querySelector('svg.lucide-message-square-text.size-5.text-primary')).not.toBeNull()
    expect(container.querySelector('svg.lucide-file-stack.mt-6.size-5.text-accent-foreground')).not.toBeNull()
    expect(container.querySelector('svg.lucide-search.size-5.text-primary')).not.toBeNull()

    expect(container.querySelector('.size-10.rounded-2xl.bg-primary.text-primary-foreground')).toBeNull()
    expect(container.querySelector('.size-12.rounded-2xl.bg-primary\\/10.text-primary')).toBeNull()
    expect(container.querySelector('.size-12.rounded-2xl.bg-accent\\/20.text-accent-foreground')).toBeNull()
  })
})
