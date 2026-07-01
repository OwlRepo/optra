/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
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

  it('redirects to first workspace chat', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/chat')
    })
  })
})
