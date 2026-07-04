/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import SettingsPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const updateWorkspaceMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/settings',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  updateWorkspace: (...args: unknown[]) => updateWorkspaceMock(...args),
}))

const changePasswordMock = vi.fn()

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
  changePassword: (...args: unknown[]) => changePasswordMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(SettingsPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    updateWorkspaceMock.mockReset()
    logoutMock.mockReset()
    changePasswordMock.mockReset()
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support' })
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Acme Support', role: 'owner' }],
      nextCursor: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the current workspace name in the rename field', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('Acme Support')).toBeDefined()
  })

  it('owner sees an editable rename form and can submit a new name', async () => {
    updateWorkspaceMock.mockResolvedValue({
      id: 'ws-1',
      name: 'Renamed Co',
      ownerId: 'u-1',
      createdAt: '',
    })

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: 'Renamed Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-1', 'Renamed Co')
      expect(screen.getByText('Workspace renamed')).toBeDefined()
    })
  })

  it('admin sees an editable rename form', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Acme Support', role: 'admin' }],
      nextCursor: null,
    })

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    expect((input as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDefined()
  })

  it('plain member sees the rename field disabled and no save button', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Acme Support', role: 'member' }],
      nextCursor: null,
    })

    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('blocks submit client-side for an empty name and does not call the API', async () => {
    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Workspace name is required')).toBeDefined()
    expect(updateWorkspaceMock).not.toHaveBeenCalled()
  })

  it('blocks submit client-side for a too-long name and does not call the API', async () => {
    renderPage()

    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: 'x'.repeat(256) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Workspace name is too long')).toBeDefined()
    expect(updateWorkspaceMock).not.toHaveBeenCalled()
  })

  it('redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('logs out and redirects to login', async () => {
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('blocks change-password submit client-side when confirm does not match', async () => {
    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'does-not-match' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Passwords do not match')).toBeDefined()
    expect(changePasswordMock).not.toHaveBeenCalled()
  })

  it('blocks change-password submit client-side for a new password under 8 characters', async () => {
    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password must be at least 8 characters')).toBeDefined()
    expect(changePasswordMock).not.toHaveBeenCalled()
  })

  it('changes password successfully, toasts, logs out, and redirects to login', async () => {
    changePasswordMock.mockResolvedValue({ message: 'Password changed. Please log in again.' })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith('old-pass', 'newpassword123')
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('shows an inline error and does not log out when the current password is wrong', async () => {
    changePasswordMock.mockRejectedValue({ statusCode: 401, message: 'Current password is incorrect' })

    renderPage()

    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'wrong-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect')).toBeDefined()
    expect(logoutMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalledWith('/login')
  })
})
