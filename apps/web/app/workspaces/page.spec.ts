/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('error: redirects to login on unauthorized fetch', async () => {
    listWorkspacesMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('error: an empty name shows the zod message in the field slot and marks the field invalid', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByText('Workspace name is required')).toBeDefined()
    expect(screen.getByLabelText('Workspace name').getAttribute('aria-invalid')).toBe('true')
    expect(createWorkspaceMock).not.toHaveBeenCalled()
  })

  it('error: still redirects to login when logout rejects', async () => {
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

  it('edge: hides load more button when workspace nextCursor is null', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Alpha', role: 'owner' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha', undefined, { timeout: 2000 })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Load more workspaces' })).toBeNull()
  })

  it('edge: the empty state keeps a single New workspace action, the one in the top bar', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })
    expect(screen.getAllByRole('button', { name: 'New workspace' })).toHaveLength(1)
  })

  // [support-surfaces-off] was: '…into chat…' → '/workspaces/ws-1/chat'
  it('regression: opens a workspace directly into Purchase Orders (default landing page)', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Alpha', role: 'owner' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/workspaces/ws-1/procurement')
  })

  it('regression: the row link reads "Open →" with the arrow hidden from assistive tech, inside a table row', async () => {
    listWorkspacesMock.mockResolvedValue({
      items: [{ id: 'ws-1', name: 'Alpha', role: 'owner' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Alpha')).toBeDefined()
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link.textContent).toBe('Open →')
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('→')
    expect(link.closest('tr')).not.toBeNull()
  })

  it('regression: the hero copy names vendors, documents, and member permissions', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(screen.getByText('Tenant access')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Your workspaces' })).toBeDefined()
    expect(screen.getByText('Each workspace keeps its own vendors, documents, and member permissions.')).toBeDefined()
    await waitFor(() => {
      expect(listWorkspacesMock).toHaveBeenCalledTimes(1)
    })
  })

  it('regression: the empty state points at matching purchase orders under a "Start here" label', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText('Create your first workspace to start matching purchase orders.')).toBeDefined()
    expect(screen.getByText('Start here')).toBeDefined()
  })

  it('regression: the create modal carries the "New" eyebrow', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))

    expect(within(screen.getByRole('dialog')).getByText('New')).toBeDefined()
  })

  it('regression: the top bar links the Optra wordmark home', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    await waitFor(() => {
      expect(listWorkspacesMock).toHaveBeenCalledTimes(1)
    })
  })

  it('happy: renders fetched workspaces', async () => {
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

  it('happy: renders empty state when there are no workspaces', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined()
    })
  })

  it('happy: creates a workspace from the modal and refreshes the list', async () => {
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
    // The submit button now lives in the modal footer and submits the form via form=.
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith('Gamma')
      expect(listWorkspacesMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Gamma')).toBeDefined()
    })
  })

  it('happy: renders load more button and appends next workspace page', async () => {
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

  it('happy: logs out and redirects to login', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
