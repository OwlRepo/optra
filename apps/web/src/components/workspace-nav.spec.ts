/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
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

  it('happy: renders the seven kept items with correct hrefs in order', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Overview', '/workspaces/w1'],
      ['Members', '/workspaces/w1/members'],
      ['Settings', '/workspaces/w1/settings'],
      ['Vendors', '/workspaces/w1/vendors'],
      ['Purchase Orders', '/workspaces/w1/procurement'],
      ['Discrepancies', '/workspaces/w1/discrepancies'],
      ['Catalog Matches', '/workspaces/w1/catalog-matches'],
    ])
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

  it('renders unread-count badge on Overview when count is positive', async () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 3 })

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(await screen.findByText('3')).toBeTruthy()
  })

  it('renders no unread-count badge when count is zero', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    getUnreadCountMock.mockResolvedValue({ count: 0 })

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.queryByText('0')).toBeNull()
  })
})
