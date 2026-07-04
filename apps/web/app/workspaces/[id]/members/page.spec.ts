/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import MembersPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listMembersMock = vi.fn()
const inviteMemberMock = vi.fn()
const removeMemberMock = vi.fn()
const getCurrentUserMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/members',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  listMembers: (...args: unknown[]) => listMembersMock(...args),
  inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(MembersPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('MembersPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listMembersMock.mockReset()
    inviteMemberMock.mockReset()
    removeMemberMock.mockReset()
    getCurrentUserMock.mockReset()
    logoutMock.mockReset()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listMembersMock.mockResolvedValue({
      items: [
        { id: 'mem-1', userId: 'user-owner', email: 'owner@example.com', role: 'owner', joinedAt: '2026-06-01T00:00:00.000Z' },
        { id: 'mem-2', userId: 'user-2', email: 'teammate@example.com', role: 'member', joinedAt: '2026-06-15T00:00:00.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    })
    getCurrentUserMock.mockResolvedValue({ userId: 'user-owner', email: 'owner@example.com' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched member list', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    expect(await screen.findByText('owner@example.com')).toBeDefined()
    expect(screen.getByText('teammate@example.com')).toBeDefined()
  })

  it('shows remove button only for owner viewer on other rows', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove owner@example.com' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove teammate@example.com' })).toBeDefined()
  })

  it('hides remove buttons for member and admin viewers', async () => {
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

    const view = renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove teammate@example.com' })).toBeNull()
    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
    renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove teammate@example.com' })).toBeNull()
  })

  it('shows invite form for owner and admin, empty state for member', async () => {
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })

    const view = renderPage()

    expect(await screen.findByLabelText('Member email')).toBeDefined()
    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })
    renderPage()

    expect(await screen.findByText('Invite controls hidden')).toBeDefined()
    expect(screen.queryByLabelText('Member email')).toBeNull()
  })

  it('submits invite, resets form, and toasts success', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    inviteMemberMock.mockResolvedValue({ message: 'Invite sent' })

    renderPage()

    await screen.findByLabelText('Member email')
    fireEvent.change(screen.getByLabelText('Member email'), { target: { value: 'teammate@example.com' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Send invite' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(inviteMemberMock).toHaveBeenCalledWith('ws-1', 'teammate@example.com')
      expect((screen.getByLabelText('Member email') as HTMLInputElement).value).toBe('')
      expect(screen.getByText('Invite sent')).toBeDefined()
    })
  })

  it('removes member after confirmation and reloads list', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listMembersMock
      .mockResolvedValueOnce({
        items: [
          { id: 'mem-1', userId: 'user-owner', email: 'owner@example.com', role: 'owner', joinedAt: '2026-06-01T00:00:00.000Z' },
          { id: 'mem-2', userId: 'user-2', email: 'teammate@example.com', role: 'member', joinedAt: '2026-06-15T00:00:00.000Z' },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'mem-1', userId: 'user-owner', email: 'owner@example.com', role: 'owner', joinedAt: '2026-06-01T00:00:00.000Z' }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      })
    removeMemberMock.mockResolvedValue({ message: 'Removed' })

    renderPage()

    await screen.findByText('teammate@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Remove teammate@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))

    await waitFor(() => {
      expect(removeMemberMock).toHaveBeenCalledWith('ws-1', 'user-2')
      expect(screen.queryByText('teammate@example.com')).toBeNull()
    })
  })

  it('shows 403 remove error toast and keeps list unchanged', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    removeMemberMock.mockRejectedValue({ statusCode: 403, message: 'Cannot remove the last owner' })

    renderPage()

    await screen.findByText('teammate@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Remove teammate@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))

    await waitFor(() => {
      expect(screen.getByText('Cannot remove the last owner')).toBeDefined()
    })
    expect(screen.getByText('teammate@example.com')).toBeDefined()
  })

  it('paginates to the next page via the pagination control', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listMembersMock.mockResolvedValue({
      items: [{ id: 'mem-1', userId: 'user-owner', email: 'owner@example.com', role: 'owner', joinedAt: '2026-06-01T00:00:00.000Z' }],
      page: 1,
      pageSize: 20,
      total: 40,
      totalPages: 2,
    })

    renderPage()

    expect(await screen.findByText('owner@example.com')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ page: 2 }))
    })
  })

  it('searches members by email through the backend', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    await screen.findByText('owner@example.com')
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'teammate' } })

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ q: 'teammate' }))
    })
  })

  it('filters members by role through the backend', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    await screen.findByText('owner@example.com')
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'member' } })

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ role: 'member' }))
    })
  })
})
