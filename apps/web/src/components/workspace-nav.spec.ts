/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceNav } from './workspace-nav'

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

  it('renders all items with correct hrefs', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/workspaces/w1')
    expect(screen.getByRole('link', { name: 'Knowledge Bases' }).getAttribute('href')).toBe('/workspaces/w1/knowledge-bases')
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe('/workspaces/w1/members')
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('href')).toBe('/workspaces/w1/chat')
    expect(screen.getByRole('link', { name: 'Tickets' }).getAttribute('href')).toBe('/workspaces/w1/tickets')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/workspaces/w1/settings')
  })

  it('marks only Overview active on overview route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Knowledge Bases' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks Knowledge Bases active on knowledge-base index route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/knowledge-bases')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Knowledge Bases' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })

  it('keeps Knowledge Bases active on knowledge-base detail route', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/knowledge-bases/kb1')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: false }))

    expect(screen.getByRole('link', { name: 'Knowledge Bases' }).getAttribute('aria-current')).toBe('page')
  })

  it('keeps labels in DOM with sr-only class when collapsed', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/chat')

    render(React.createElement(WorkspaceNav, { workspaceId: 'w1', collapsed: true }))

    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy()
    const label = screen.getByText('Chat')
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
