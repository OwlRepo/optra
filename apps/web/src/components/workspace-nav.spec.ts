/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceNav, workspacePrimaryTabItems } from './workspace-nav'

const usePathnameMock = vi.fn()
const getUnreadCountMock = vi.fn()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/events', () => ({
  getUnreadCount: (...args: unknown[]) => getUnreadCountMock(...args),
}))

async function flushUnreadCount() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('WorkspaceNav', () => {
  beforeEach(() => {
    usePathnameMock.mockReset()
    getUnreadCountMock.mockReset()
    pushMock.mockReset()
    getUnreadCountMock.mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    cleanup()
  })

  // [support-surfaces-off] On re-enable, restore the original cases from git
  // history (they asserted Knowledge Bases/Chat/Tickets links and the search
  // slot's mb-4) and drop the "hides" cases below.
  it('edge: does not render the workspace search slot', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.queryByTestId('workspace-search-slot')).toBeNull()
  })

  it('edge: the collapsed rail shows neither the active dot nor the unread pill', async () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 3 })

    const { container } = render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: true }))
    await flushUnreadCount()

    expect(getUnreadCountMock).toHaveBeenCalledWith('w1')
    expect(screen.queryByText('3')).toBeNull()
    expect(container.querySelector('[data-nav-indicator]')).toBeNull()
  })

  it('regression: hides Knowledge Bases, Datasets, Chat, Tickets and Insights', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    for (const label of ['Knowledge Bases', 'Datasets', 'Chat', 'Tickets', 'Insights']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull()
    }
  })

  it('regression: primary tabs are Overview, Purchase Orders and Discrepancies', () => {
    expect(workspacePrimaryTabItems('w1').map((item) => [item.label, item.href])).toEqual([
      ['Overview', '/workspaces/w1'],
      ['Purchase Orders', '/workspaces/w1/procurement'],
      ['Discrepancies', '/workspaces/w1/discrepancies'],
    ])
  })

  it('regression: groups the items under Matching and Workspace micro labels', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    const matching = screen.getByRole('group', { name: 'Matching' })
    const workspace = screen.getByRole('group', { name: 'Workspace' })
    expect(within(matching).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Overview',
      'Purchase Orders',
      'Discrepancies',
      'Catalog Matches',
      'Vendors',
    ])
    expect(within(workspace).getAllByRole('link').map((link) => link.textContent)).toEqual(['Members', 'Settings', 'Billing'])
  })

  // Intentional order change (frame 4.1 amber): Matching first, admin last.
  it('regression: renders the eight kept items Matching-first with unchanged hrefs', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Overview', '/workspaces/w1'],
      ['Purchase Orders', '/workspaces/w1/procurement'],
      ['Discrepancies', '/workspaces/w1/discrepancies'],
      ['Catalog Matches', '/workspaces/w1/catalog-matches'],
      ['Vendors', '/workspaces/w1/vendors'],
      ['Members', '/workspaces/w1/members'],
      ['Settings', '/workspaces/w1/settings'],
      ['Billing', '/workspaces/w1/billing'],
    ])
  })

  it('regression: the active item carries the 6px teal dot and inactive items carry none', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/vendors')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    const vendors = screen.getByRole('link', { name: 'Vendors' })
    expect(vendors.querySelector('[data-nav-indicator="dot"]')).not.toBeNull()
    expect(vendors.classList.contains('shadow-nav')).toBe(true)
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-nav-indicator]')).toBeNull()
  })

  it('regression: the unread pill replaces the dot on an active Overview', async () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 3 })

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    const pill = await screen.findByText('3')
    expect(pill.getAttribute('data-nav-indicator')).toBe('unread')
    expect(pill.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-nav-indicator="dot"]')).toBeNull()
  })

  it('happy: marks only Overview active on overview route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Vendors' }).getAttribute('aria-current')).toBeNull()
  })

  it('happy: marks Vendors active on vendors index route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/vendors')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Vendors' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })

  it('happy: keeps Vendors active on vendor detail route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/vendors/v1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Vendors' }).getAttribute('aria-current')).toBe('page')
  })

  it('happy: keeps labels in DOM with sr-only class when collapsed', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/members')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: true }))

    expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy()
    const label = screen.getByText('Members')
    expect(label.className).toContain('sr-only')
  })

  it('happy: renders unread-count badge on Overview when count is positive', async () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 3 })

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(await screen.findByText('3')).toBeTruthy()
  })

  it('happy: renders no unread-count badge when count is zero', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 0 })

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.queryByText('0')).toBeNull()
  })
})
