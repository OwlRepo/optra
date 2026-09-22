/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import WorkspaceOverviewPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const logoutMock = vi.fn()
const listEventsMock = vi.fn()
const markEventsSeenMock = vi.fn()
const getUnreadCountMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/events', () => ({
  listEvents: (...args: unknown[]) => listEventsMock(...args),
  markEventsSeen: (...args: unknown[]) => markEventsSeenMock(...args),
  getUnreadCount: (...args: unknown[]) => getUnreadCountMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceOverviewPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('WorkspaceOverviewPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    logoutMock.mockReset()
    listEventsMock.mockReset()
    markEventsSeenMock.mockReset()
    getUnreadCountMock.mockReset()
    listEventsMock.mockResolvedValue({ items: [], nextCursor: null })
    markEventsSeenMock.mockResolvedValue({})
    getUnreadCountMock.mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // no-op keeps test order explicit after previous mock cleanup
  })

  it('renders workspace name in top bar and membership badge', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    expect((await screen.findAllByText('Alpha')).length).toBeGreaterThan(0)
    expect(screen.getByText('owner')).toBeDefined()
  })

  it('renders all 5 quick-link cards with correct hrefs', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

    const { container } = renderPage()

    const sidebar = within(screen.getByRole('complementary'))
    const kbLink = await sidebar.findByRole('link', { name: 'Knowledge Bases' })
    expect(kbLink.getAttribute('href')).toBe('/workspaces/ws-1/knowledge-bases')
    expect(sidebar.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe('/workspaces/ws-1/members')
    expect(sidebar.getByRole('link', { name: 'Chat' }).getAttribute('href')).toBe('/workspaces/ws-1/chat')
    expect(sidebar.getByRole('link', { name: 'Tickets' }).getAttribute('href')).toBe('/workspaces/ws-1/tickets')
    expect(sidebar.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/workspaces/ws-1/settings')
    expect(container.querySelector('span.shrink-0.text-accent-foreground')).not.toBeNull()
    expect(container.querySelector('.rounded-2xl.bg-accent\\/20.text-accent-foreground')).toBeNull()
  })

  it('redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('surfaces non-unauthorized load error as toast', async () => {
    getWorkspaceMock.mockRejectedValue(new Error('boom'))
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    expect((await screen.findAllByText('Alpha')).length).toBeGreaterThan(0)
    expect(screen.getByText('Failed to load workspace')).toBeDefined()
  })

  it('renders activity feed rows and marks events seen once after load', async () => {
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 2, 2026, 9:00 AM')
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listEventsMock.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          type: 'document_ingested',
          title: 'Imported guide',
          detail: null,
          createdAt: '2026-07-02T01:00:00.000Z',
        },
      ],
      nextCursor: null,
    })

    const { container } = renderPage()

    expect(await screen.findByText('Imported guide')).toBeDefined()
    expect(screen.getByText('Jul 2, 2026, 9:00 AM')).toBeDefined()
    expect(container.querySelector('span.shrink-0.text-secondary-foreground')).not.toBeNull()
    expect(container.querySelector('.rounded-2xl.bg-secondary.text-secondary-foreground')).toBeNull()
    await waitFor(() => {
      expect(markEventsSeenMock).toHaveBeenCalledTimes(1)
      expect(markEventsSeenMock).toHaveBeenCalledWith('ws-1')
    })
  })

  // The icon switch has a `default`, so a new event type compiles fine and
  // renders the generic alert glyph — the failure mode has no compiler
  // tripwire. This asserts the comparison types resolve to their own icon by
  // comparing against what an unknown type actually falls through to.
  it('gives comparison events their own icon rather than the generic fallback', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listEventsMock.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          type: 'comparison_flagged',
          title: '3 discrepancies found',
          detail: null,
          createdAt: '2026-07-02T01:00:00.000Z',
        },
        {
          id: 'evt-2',
          type: 'comparison_failed',
          title: 'Comparison failed',
          detail: null,
          createdAt: '2026-07-02T01:00:00.000Z',
        },
        {
          id: 'evt-3',
          type: 'not_a_real_type' as never,
          title: 'Unknown',
          detail: null,
          createdAt: '2026-07-02T01:00:00.000Z',
        },
      ],
      nextCursor: null,
    })

    const { container } = renderPage()

    expect(await screen.findByText('3 discrepancies found')).toBeDefined()
    const icons = Array.from(container.querySelectorAll('span.shrink-0.text-secondary-foreground svg'))
    expect(icons).toHaveLength(3)
    const fallback = icons[2].getAttribute('class')
    expect(icons[0].getAttribute('class')).not.toBe(fallback)
    expect(icons[1].getAttribute('class')).not.toBe(fallback)
  })

  it('renders empty state when there is no activity', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listEventsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText('No activity yet')).toBeDefined()
  })
})
