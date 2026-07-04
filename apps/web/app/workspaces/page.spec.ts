/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import WorkspacesPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const listWorkspacesMock = vi.fn()
const createWorkspaceMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  createWorkspace: (...args: unknown[]) => createWorkspaceMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(React.createElement(ToastProvider, undefined, React.createElement(WorkspacesPage)))
}

describe('WorkspacesPage', () => {
  beforeEach(() => {
    listWorkspacesMock.mockReset()
    createWorkspaceMock.mockReset()
    logoutMock.mockReset()
    pushMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched workspaces', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [
        { id: 'ws-1', name: 'Alpha', role: 'owner' },
        { id: 'ws-2', name: 'Bravo', role: 'member' },
      ],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha', undefined, { timeout: 2000 })).toBeDefined()
    expect(screen.getByText('Bravo')).toBeDefined()
    expect(screen.getByText('owner')).toBeDefined()
    expect(screen.getByText('member')).toBeDefined()
  })

  it('opens a workspace directly into chat (default landing page)', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Alpha', role: 'owner' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/workspaces/ws-1/chat')
  })

  it('renders empty state when there are no workspaces', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })
  })

  it('creates a workspace from the modal and refreshes the list', async () => {
    listWorkspacesMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'ws-3', name: 'Gamma', role: 'owner' }], nextCursor: null })
    createWorkspaceMock.mockResolvedValue({ id: 'ws-3', name: 'Gamma', role: 'owner' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'New workspace' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Gamma' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create workspace' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith('Gamma')
      expect(listWorkspacesMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Gamma')).toBeDefined()
    })
  })

  it('redirects to login on unauthorized fetch', async () => {
    listWorkspacesMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('renders load more button and appends next workspace page', async () => {
    listWorkspacesMock
      .mockResolvedValueOnce({
        items: [
          { id: 'ws-1', name: 'Alpha', role: 'owner' },
          { id: 'ws-2', name: 'Bravo', role: 'member' },
        ],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'ws-3', name: 'Gamma', role: 'owner' }],
        nextCursor: null,
      })

    renderPage()

    expect(await screen.findByText('Alpha', undefined, { timeout: 2000 })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Load more workspaces' }))

    await waitFor(() => {
      expect(listWorkspacesMock).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1' })
      expect(screen.getByText('Gamma')).toBeDefined()
    })
  })

  it('hides load more button when workspace nextCursor is null', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Alpha', role: 'owner' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha', undefined, { timeout: 2000 })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Load more workspaces' })).toBeNull()
  })

  it('logs out and redirects to login', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('still redirects to login when logout rejects', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    logoutMock.mockRejectedValue(new Error('boom'))
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault()
    }, { once: true })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
