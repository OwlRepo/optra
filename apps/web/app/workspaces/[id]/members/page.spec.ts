/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import MembersPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
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
  listMembers: (...args: unknown[]) => listMembersMock(...args),
  inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logout: (...args: unknown[]) => logoutMock(...args),
}))

const roster = {
  items: [
    { id: 'mem-1', userId: 'user-owner', email: 'owner@example.com', role: 'owner', joinedAt: new Date(2026, 5, 1, 12, 0).toISOString() },
    { id: 'mem-2', userId: 'user-2', email: 'teammate@example.com', role: 'member', joinedAt: new Date(2026, 5, 15, 12, 0).toISOString() },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  totalPages: 1,
}

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

function rowOf(email: string): HTMLTableRowElement {
  return screen.getByText(email).closest('tr') as HTMLTableRowElement
}

describe('MembersPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listMembersMock.mockReset()
    inviteMemberMock.mockReset()
    removeMemberMock.mockReset()
    getCurrentUserMock.mockReset()
    logoutMock.mockReset()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listMembersMock.mockResolvedValue(roster)
    getCurrentUserMock.mockResolvedValue({ userId: 'user-owner', email: 'owner@example.com' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: shows the 403 remove error toast and keeps the list unchanged', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    removeMemberMock.mockRejectedValue({ statusCode: 403, message: 'Cannot remove the last owner' })

    renderPage()

    await screen.findByText('teammate@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Remove teammate@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))

    await waitFor(() => {
      expect(screen.getByText('Cannot remove the last owner')).toBeDefined()
    })
    // The confirm modal stays open and names the email too, so the list is
    // checked inside the table.
    expect(within(screen.getByRole('table')).getByText('teammate@example.com')).toBeDefined()
  })

  it('edge: hides Remove for member and admin viewers', async () => {
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })

    const view = renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove teammate@example.com' })).toBeNull()
    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'admin' })
    renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove teammate@example.com' })).toBeNull()
  })

  // [RED] the role-gated empty has no "Owners & admins" label today.
  it('edge: members get the "Owners & admins" role-gated empty instead of the invite form; admins get the form', async () => {
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'admin' })

    const view = renderPage()

    expect(await screen.findByLabelText('Member email')).toBeDefined()
    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })
    renderPage()

    expect(await screen.findByText('Invite controls hidden')).toBeDefined()
    expect(screen.getByText('Owners & admins')).toBeDefined()
    expect(screen.getByText('Only owners and admins can invite members to this workspace.')).toBeDefined()
    expect(screen.queryByLabelText('Member email')).toBeNull()
  })

  // [RED] no search label on the empty today, and the filters must stay reachable.
  it('edge: no results name the search and keep the search and role filter on screen', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('owner@example.com')
    listMembersMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'ops@' } })

    expect(await screen.findByText('No members found')).toBeDefined()
    expect(screen.getByText('Try a different search or role filter.')).toBeDefined()
    expect(screen.getByText('Search · "ops@"')).toBeDefined()
    expect(screen.getByLabelText('Search members')).toBeDefined()
    expect(screen.getByLabelText('Filter by role')).toBeDefined()
  })

  // [RED] amber 3.8 copy: the developer note is replaced.
  it('regression: the invite description is user-facing copy, not a developer note', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    expect(await screen.findByText('Invites go out by email. The link joins them to this workspace as a member.')).toBeDefined()
    expect(screen.queryByText(/Backend still enforces permissions/)).toBeNull()
  })

  // [RED] amber 3.8: Mono "you" tag on the viewer's own row.
  it('regression: the viewer\'s own row carries a Mono "you" tag and no Remove; other rows do not', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('teammate@example.com')
    await waitFor(() => {
      expect(within(rowOf('owner@example.com')).getByText('you')).toBeDefined()
    })
    expect(within(rowOf('owner@example.com')).getByText('you').className).toContain('font-mono')
    expect(within(rowOf('owner@example.com')).queryByRole('button')).toBeNull()
    expect(within(rowOf('teammate@example.com')).queryByText('you')).toBeNull()
    expect(within(rowOf('owner@example.com')).getByText('Owner')).toBeDefined()
    expect(within(rowOf('teammate@example.com')).getByText('Member')).toBeDefined()
  })

  // [RED] Remove is plain ghost today.
  it('regression: Remove is a ghost button that turns red on hover', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    const remove = await screen.findByRole('button', { name: 'Remove teammate@example.com' })
    expect(remove.className).toContain('hover:text-destructive-strong-text')
    expect(remove.className).toContain('hover:bg-destructive-tone/8')
  })

  // [RED] the confirm modal has no eyebrow today.
  it('regression: the remove confirm modal is eyebrowed "Confirm"', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove teammate@example.com' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Confirm')).toBeDefined()
    expect(within(dialog).getByText('teammate@example.com')).toBeDefined()
    expect(within(dialog).getByRole('button', { name: 'Remove member' })).toBeDefined()
  })

  // [RED] the roster repeated the page description under its title.
  it('regression: search and role filter head the roster table panel, and the roster drops the duplicate description', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('teammate@example.com')
    let panel: HTMLElement | null = screen.getByLabelText('Search members').parentElement
    while (panel && !panel.querySelector('table')) panel = panel.parentElement
    expect(panel).not.toBeNull()
    expect((panel as HTMLElement).contains(screen.getByLabelText('Filter by role'))).toBe(true)
    expect(within(panel as HTMLElement).getByRole('navigation', { name: 'Pagination' })).toBeDefined()
    expect(within(panel as HTMLElement).queryByRole('heading', { level: 2, name: 'Members' })).toBeNull()

    const rosterSection = screen.getByRole('heading', { level: 2, name: 'Members' }).closest('section') as HTMLElement
    expect(within(rosterSection).queryByText('Everyone with access to this workspace.')).toBeNull()
  })

  it('happy: renders the fetched member list with local ISO joined dates', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    expect(await screen.findByText('owner@example.com')).toBeDefined()
    expect(screen.getByText('teammate@example.com')).toBeDefined()
    expect(screen.getByText('2026-06-01')).toBeDefined()
    expect(screen.getByText('2026-06-15')).toBeDefined()
  })

  it('happy: shows Remove only to an owner viewer, on other rows', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('teammate@example.com')
    expect(screen.queryByRole('button', { name: 'Remove owner@example.com' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove teammate@example.com' })).toBeDefined()
  })

  it('happy: submits an invite, resets the form and toasts success', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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

  it('happy: removes a member after confirmation and reloads the list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listMembersMock
      .mockResolvedValueOnce(roster)
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

  it('happy: paginates to the next page via the docked pagination', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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

  it('happy: searches members by email through the backend', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('owner@example.com')
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'teammate' } })

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ q: 'teammate' }))
    })
  })

  it('happy: filters members by role through the backend', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    renderPage()

    await screen.findByText('owner@example.com')
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'member' } })

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ role: 'member' }))
    })
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)
      listMembersMock.mockRejectedValue(denied)

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load workspace')).toBeNull()
      expect(screen.queryByText('Failed to load members')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })
      listMembersMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })

      renderPage()

      expect(await screen.findByText('Failed to load workspace')).toBeDefined()
      expect(await screen.findByText('Failed to load members')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })
})
