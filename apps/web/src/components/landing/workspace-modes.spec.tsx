/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceModes } from './workspace-modes'

afterEach(cleanup)

describe('WorkspaceModes', () => {
  it('opens on Personal with that mode selected', () => {
    render(<WorkspaceModes />)

    expect(screen.getByRole('tab', { name: 'Personal' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Team' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('heading', { name: 'Your own purchasing memory' })).not.toBeNull()
  })

  it('swaps the panel content when Team is chosen', () => {
    render(<WorkspaceModes />)

    fireEvent.click(screen.getByRole('tab', { name: 'Team' }))

    expect(screen.getByRole('heading', { name: 'One catalog, every buyer' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your own purchasing memory' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Team' }).getAttribute('aria-selected')).toBe('true')
  })

  // The predecessor (workspace-tabs.tsx) had role=tablist/tab but no panel
  // wiring at all -- assistive tech had no way to associate the two.
  it('associates the selected tab with its panel', () => {
    render(<WorkspaceModes />)

    const tab = screen.getByRole('tab', { name: 'Personal' })
    const panel = screen.getByRole('tabpanel')

    expect(panel.getAttribute('id')).toBe(tab.getAttribute('aria-controls'))
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'))
  })

  it('renders the bullets for the active mode', () => {
    render(<WorkspaceModes />)

    expect(screen.getByText(/no formatting first/i)).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByText(/same approved vendor catalog/i)).not.toBeNull()
  })

  it('keeps the three value cards visible in both modes', () => {
    render(<WorkspaceModes />)

    for (const eyebrow of ['Onboarding', 'Continuity', 'Efficiency']) {
      expect(screen.getByText(eyebrow)).not.toBeNull()
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Team' }))
    for (const eyebrow of ['Onboarding', 'Continuity', 'Efficiency']) {
      expect(screen.getByText(eyebrow)).not.toBeNull()
    }
  })
})
