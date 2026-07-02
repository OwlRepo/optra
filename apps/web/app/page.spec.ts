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
})
