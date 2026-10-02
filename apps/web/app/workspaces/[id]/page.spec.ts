/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// HistoryRow's look belongs to packages/ui and is tested there. What this page
// owns is the tone and the unseen flag it picks for each event, so the real row
// is rendered inside a wrapper that exposes those two choices as data.
vi.mock('@repo/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/ui')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    HistoryRow: (props: React.ComponentProps<typeof actual.HistoryRow>) =>
      createElement(
        'div',
        {
          'data-testid': 'history-row',
          'data-event': props.eventKey,
          'data-tone': props.tone,
          'data-unseen': String(Boolean(props.unseen)),
        },
        createElement(actual.HistoryRow, props),
      ),
  }
})

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

function event(id: string, type: string, title: string, detail: string | null = null) {
  return { id, type, title, detail, createdAt: new Date(2026, 6, 2, 9, 0).toISOString() }
}

function signedInAs(role: 'owner' | 'admin' | 'member') {
  getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
  listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role }], nextCursor: null })
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

  it('error: redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('error: surfaces a non-unauthorized load error as a toast', async () => {
    getWorkspaceMock.mockRejectedValue(new Error('boom'))
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    expect((await screen.findAllByText('Alpha')).length).toBeGreaterThan(0)
    expect(screen.getByText('Failed to load workspace')).toBeDefined()
  })

  it('error: a failed unread-count read still renders the feed, without the "new" line, and marks seen once', async () => {
    signedInAs('owner')
    getUnreadCountMock.mockRejectedValue(new Error('unread down'))
    listEventsMock.mockResolvedValue({ items: [event('evt-1', 'document_ingested', 'Imported guide')], nextCursor: null })

    renderPage()

    expect(await screen.findByText('Imported guide')).toBeDefined()
    expect(screen.queryByText(/new since your last visit/)).toBeNull()
    expect(screen.queryByText('Failed to load workspace')).toBeNull()
    await waitFor(() => {
      expect(markEventsSeenMock).toHaveBeenCalledTimes(1)
    })
  })

  // [RED] no HistoryRow today.
  it('edge: an unknown event type falls back to the neutral tone instead of breaking the feed', async () => {
    signedInAs('owner')
    listEventsMock.mockResolvedValue({ items: [event('evt-1', 'not_a_real_type', 'Unknown')], nextCursor: null })

    renderPage()

    const row = await screen.findByTestId('history-row')
    expect(row.dataset.tone).toBe('neutral')
    expect(within(row).getByText('Unknown')).toBeDefined()
  })

  // [RED] no HistoryRow today.
  it('edge: nothing unread means no "new" line and no tinted rows', async () => {
    signedInAs('owner')
    getUnreadCountMock.mockResolvedValue({ count: 0 })
    listEventsMock.mockResolvedValue({
      items: [event('evt-1', 'document_ingested', 'Imported guide'), event('evt-2', 'scrape_failed', 'Crawl stopped')],
      nextCursor: null,
    })

    renderPage()

    const rows = await screen.findAllByTestId('history-row')
    expect(rows.map((row) => row.dataset.unseen)).toEqual(['false', 'false'])
    expect(screen.queryByText(/new since your last visit/)).toBeNull()
  })

  // [RED] the empty state has no label today.
  it('edge: an empty feed shows the teal "Quiet so far" empty state', async () => {
    signedInAs('owner')

    renderPage()

    expect(await screen.findByText('No activity yet')).toBeDefined()
    expect(screen.getByText('Quiet so far')).toBeDefined()
    expect(screen.getByText('Work this workspace does on its own will show up here.')).toBeDefined()
  })

  // [RED] replaces the icon-class selectors (C-2): every workspace_event_type has its C19 tone.
  it('regression: every workspace_event_type renders as a history row in its C19 tone', async () => {
    signedInAs('owner')
    const expected = [
      ['document_ingested', 'teal'],
      ['document_failed', 'red'],
      ['scrape_completed', 'teal'],
      ['scrape_failed', 'red'],
      ['ticket_extracted', 'neutral'],
      ['ticket_failed', 'red'],
      ['comparison_flagged', 'amber'],
      ['comparison_failed', 'red'],
    ]
    listEventsMock.mockResolvedValue({
      items: expected.map(([type], index) => event(`evt-${index}`, type, `Event ${type}`)),
      nextCursor: null,
    })

    renderPage()

    const rows = await screen.findAllByTestId('history-row')
    expect(rows.map((row) => [row.dataset.event, row.dataset.tone])).toEqual(expected)
    for (const [type] of expected) {
      expect(screen.getByText(type)).toBeDefined()
    }
  })

  // [RED] amber 3.3: the count is read by the page before markEventsSeen fires.
  it('regression: rows counted unread before markEventsSeen are tinted and announced', async () => {
    signedInAs('owner')
    getUnreadCountMock.mockResolvedValue({ count: 2 })
    listEventsMock.mockResolvedValue({
      items: [
        event('evt-1', 'comparison_flagged', 'PO-1 compared'),
        event('evt-2', 'document_ingested', 'po.pdf parsed'),
        event('evt-3', 'scrape_completed', 'Crawl finished'),
      ],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('2 new since your last visit')).toBeDefined()
    const rows = screen.getAllByTestId('history-row')
    expect(rows.map((row) => row.dataset.unseen)).toEqual(['true', 'true', 'false'])
    await waitFor(() => {
      expect(markEventsSeenMock).toHaveBeenCalledTimes(1)
    })
    expect(getUnreadCountMock).toHaveBeenCalledWith('ws-1')
    expect(Math.min(...getUnreadCountMock.mock.invocationCallOrder)).toBeLessThan(
      markEventsSeenMock.mock.invocationCallOrder[0] as number,
    )
  })

  // [RED] the cards carry an icon today and no arrow.
  it('regression: quick-link cards are icon-free with a trailing arrow, and the support surfaces stay hidden', async () => {
    signedInAs('member')

    renderPage()

    const sidebar = within(screen.getByRole('complementary'))
    expect((await sidebar.findByRole('link', { name: 'Members' })).getAttribute('href')).toBe('/workspaces/ws-1/members')
    expect(sidebar.getByRole('link', { name: 'Purchase Orders' }).getAttribute('href')).toBe('/workspaces/ws-1/procurement')
    for (const label of ['Knowledge Bases', 'Chat', 'Tickets']) {
      expect(sidebar.queryByRole('link', { name: label })).toBeNull()
      expect(screen.queryByRole('heading', { level: 3, name: label })).toBeNull()
    }
    for (const label of ['Members', 'Settings']) {
      const card = screen.getByRole('heading', { level: 3, name: label }).closest('a') as HTMLAnchorElement
      expect(card.querySelector('svg')).toBeNull()
      expect(within(card).getByText('→')).toBeDefined()
    }
  })

  // [RED] breadcrumb is new and the pill read "owner" before.
  it('regression: the header shows the workspace name, the Overview breadcrumb and the role pill as the frame writes it', async () => {
    signedInAs('owner')

    renderPage()

    expect((await screen.findAllByText('Alpha')).length).toBeGreaterThan(0)
    expect(screen.getByText('Workspace / Overview')).toBeDefined()
    expect(screen.getByText('Owner')).toBeDefined()
    expect(screen.queryByText('owner')).toBeNull()
  })

  // [RED] timestamps were locale strings; C-3 #2 makes them local ISO.
  it('regression: renders activity rows with a local ISO timestamp and marks events seen once after load', async () => {
    signedInAs('owner')
    listEventsMock.mockResolvedValue({ items: [event('evt-1', 'document_ingested', 'Imported guide')], nextCursor: null })

    renderPage()

    expect(await screen.findByText('Imported guide')).toBeDefined()
    expect(screen.getByText('2026-07-02 09:00')).toBeDefined()
    await waitFor(() => {
      expect(markEventsSeenMock).toHaveBeenCalledTimes(1)
      expect(markEventsSeenMock).toHaveBeenCalledWith('ws-1')
    })
  })

  it('happy: renders the Members and Settings quick-link cards with correct hrefs', async () => {
    signedInAs('member')

    renderPage()

    const members = await screen.findByRole('heading', { level: 3, name: 'Members' })
    expect(members.closest('a')?.getAttribute('href')).toBe('/workspaces/ws-1/members')
    expect(screen.getByRole('heading', { level: 3, name: 'Settings' }).closest('a')?.getAttribute('href')).toBe('/workspaces/ws-1/settings')
  })

  it('happy: Load more fetches the next page with the cursor and appends it', async () => {
    signedInAs('owner')
    listEventsMock
      .mockResolvedValueOnce({ items: [event('evt-1', 'document_ingested', 'First page row')], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [event('evt-2', 'scrape_completed', 'Second page row')], nextCursor: null })

    renderPage()

    await screen.findByText('First page row')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Second page row')).toBeDefined()
    expect(listEventsMock).toHaveBeenLastCalledWith('ws-1', { cursor: 'cursor-2' })
    expect(screen.getByText('First page row')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)
      listEventsMock.mockRejectedValue(denied)
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load workspace')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

      renderPage()

      expect(await screen.findByText('Failed to load workspace')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })
})
