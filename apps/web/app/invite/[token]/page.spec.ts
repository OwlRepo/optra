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

  it('accepts the invite and redirects to the workspace chat (default landing page)', async () => {
    acceptInviteMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Join workspace' }))

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith('invite-token')
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/chat')
    })
  })
})
