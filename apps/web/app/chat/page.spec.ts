/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import ChatRedirectPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const listWorkspacesMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

function renderPage() {
  return render(React.createElement(ToastProvider, undefined, React.createElement(ChatRedirectPage)))
}

describe('ChatRedirectPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    listWorkspacesMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: a failed workspace lookup shows a workspace-neutral toast and falls back to /workspaces', async () => {
    listWorkspacesMock.mockRejectedValue(new Error('boom'))

    renderPage()

    expect(await screen.findByText('Workspace unavailable')).toBeTruthy()
    expect(screen.queryByText(/chat/i)).toBeNull()
    expect(pushMock).toHaveBeenCalledWith('/workspaces')
  })

  it('error: an unauthorized lookup sends the user to /login without a toast', async () => {
    listWorkspacesMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
    expect(screen.queryByText('Workspace unavailable')).toBeNull()
  })

  it('edge: sends a user with no workspace to /workspaces', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/workspaces')
    })
  })

  // [support-surfaces-off] was: 'redirects to first workspace chat' → '/workspaces/ws-1/chat'
  it('regression: redirects to the first workspace Purchase Orders', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/procurement')
    })
  })

  it('regression: the waiting panel is labelled "Redirecting…" in teal Mono', () => {
    listWorkspacesMock.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByText('Redirecting…')).toBeTruthy()
  })

  it('happy: the waiting screen does not mention chat', () => {
    listWorkspacesMock.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByText('Opening your workspace')).toBeTruthy()
    expect(screen.getByText('Picking your first available workspace and redirecting you there.')).toBeTruthy()
    expect(screen.queryByText(/chat/i)).toBeNull()
  })
})
