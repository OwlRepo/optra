/** @vitest-environment jsdom */

import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TourContext, type TourContextValue } from './tour-context'
import { TourReplayButton } from './tour-replay-button'
import { WorkspaceNav } from '../workspace-nav'

vi.mock('next/navigation', () => ({ usePathname: () => '/workspaces/ws-1' }))
vi.mock('@/lib/api/events', () => ({ getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }) }))

function withTour(ui: React.ReactElement, value: Partial<TourContextValue> = {}) {
  const context: TourContextValue = {
    startTour: vi.fn(),
    isRunning: false,
    performStageAction: vi.fn(),
    ...value,
  }
  return { context, ...render(<TourContext.Provider value={context}>{ui}</TourContext.Provider>) }
}

afterEach(() => cleanup())

describe('TourReplayButton', () => {
  it('error: renders nothing outside the tour provider', () => {
    const { container } = render(<TourReplayButton collapsed={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('edge: collapsed sidebar shows an icon-only button that keeps its accessible name', () => {
    withTour(<TourReplayButton collapsed />)
    const button = screen.getByRole('button', { name: 'Take the tour' })
    expect(button.textContent).toBe('')
  })

  it('regression: the button sits in the sidebar footer, not at the end of the nav list', () => {
    // It used to render inside <nav>, right under Settings; the owner moved it
    // to the footer, above the divider over Log out (AppShell `userFooter`).
    withTour(<WorkspaceNav workspaceId="ws-1" collapsed={false} />)
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull()
  })

  it('regression: it matches the Log out row styling (ghost, ink-ghost, card hover)', () => {
    withTour(<TourReplayButton collapsed={false} />)
    const button = screen.getByRole('button', { name: 'Take the tour' })
    expect(button.className).toContain('text-ink-ghost')
    expect(button.className).toContain('hover:bg-card')
    expect(button.getAttribute('data-tour')).toBe('tour-replay')
  })

  it('happy: clicking it starts the tour with itself as the opener', () => {
    const { context } = withTour(<TourReplayButton collapsed={false} />)
    const button = screen.getByRole('button', { name: 'Take the tour' })
    fireEvent.click(button)
    expect(context.startTour).toHaveBeenCalledWith(button)
  })
})
