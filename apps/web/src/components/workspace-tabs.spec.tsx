/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { User, Users } from 'lucide-react'
import { WorkspaceTabs, type WorkspaceMode } from './workspace-tabs'

const modes: WorkspaceMode[] = [
  {
    id: 'personal',
    icon: <User className="size-4" />,
    label: 'Personal',
    title: 'Your own second brain',
    description: 'Solo agents description',
    bullets: ['Bullet one', 'Bullet two'],
  },
  {
    id: 'team',
    icon: <Users className="size-4" />,
    label: 'Team',
    title: 'One brain, every agent',
    description: 'Team agents description',
    bullets: ['Team bullet one', 'Team bullet two'],
  },
]

describe('WorkspaceTabs', () => {
  afterEach(cleanup)

  it('shows the first mode by default', () => {
    render(<WorkspaceTabs modes={modes} />)

    expect(screen.getByText('Your own second brain')).not.toBeNull()
    expect(screen.getByText('Bullet one')).not.toBeNull()
    expect(screen.queryByText('One brain, every agent')).toBeNull()
  })

  it('switches panels when a different tab is selected', () => {
    render(<WorkspaceTabs modes={modes} />)

    fireEvent.click(screen.getByRole('tab', { name: /Team/i }))

    expect(screen.getByText('One brain, every agent')).not.toBeNull()
    expect(screen.getByText('Team bullet one')).not.toBeNull()
    expect(screen.queryByText('Your own second brain')).toBeNull()
  })

  it('marks the active tab as selected for accessibility', () => {
    render(<WorkspaceTabs modes={modes} />)

    const personalTab = screen.getByRole('tab', { name: /Personal/i })
    const teamTab = screen.getByRole('tab', { name: /Team/i })

    expect(personalTab.getAttribute('aria-selected')).toBe('true')
    expect(teamTab.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(teamTab)

    expect(teamTab.getAttribute('aria-selected')).toBe('true')
  })
})
