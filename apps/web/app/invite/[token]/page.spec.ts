/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import InvitePage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const acceptInviteMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/workspaces', () => ({
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(InvitePage, {
        params: { token: 'invite-token' },
      }),
    ),
  )
}

describe('InvitePage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    acceptInviteMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: a refused invite shows the server message verbatim in the field and in the error toast', async () => {
    acceptInviteMock.mockRejectedValue({ statusCode: 410, message: 'This invite has expired.' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    expect(await screen.findByText('Invite could not be accepted')).toBeTruthy()
    expect(screen.getAllByText('This invite has expired.').length).toBeGreaterThanOrEqual(2)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('error: an unauthorized accept sends the user to /login', async () => {
    acceptInviteMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('edge: the button reads "Joining" while the request is pending', async () => {
    acceptInviteMock.mockReturnValue(new Promise(() => {}))

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    expect(await screen.findByRole('button', { name: 'Joining' })).toBeTruthy()
  })

  it('regression: the copy names vendors, documents and discrepancy history', () => {
    renderPage()

    expect(
      screen.getByText(
        'Accept the invitation to join the shared workspace and see its vendors, documents and discrepancy history.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/knowledge bases/)).toBeNull()
  })

  it("regression: tells the user they will land on the workspace's Purchase Orders", () => {
    renderPage()

    expect(screen.getByText("You'll land on the workspace's Purchase Orders.")).toBeTruthy()
  })

  // [support-surfaces-off] was: '…redirects to the workspace chat…' → '/workspaces/ws-1/chat'
  it('regression: accepts the invite and redirects to the workspace Purchase Orders (default landing page)', async () => {
    acceptInviteMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith('invite-token')
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/procurement')
    })
  })

  it('happy: shows the success toast with the workspace name', async () => {
    acceptInviteMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    expect(await screen.findByText('Workspace joined')).toBeTruthy()
    expect(screen.getByText('You now have access to Alpha.')).toBeTruthy()
  })
})
