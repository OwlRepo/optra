/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import WorkspaceDetailPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listKnowledgeBasesMock = vi.fn()
const createKnowledgeBaseMock = vi.fn()
const deleteKnowledgeBaseMock = vi.fn()
const inviteMemberMock = vi.fn()
const listWorkspacesMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/knowledge-bases', () => ({
  listKnowledgeBases: (...args: unknown[]) => listKnowledgeBasesMock(...args),
  createKnowledgeBase: (...args: unknown[]) => createKnowledgeBaseMock(...args),
  deleteKnowledgeBase: (...args: unknown[]) => deleteKnowledgeBaseMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceDetailPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('WorkspaceDetailPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listKnowledgeBasesMock.mockReset()
    createKnowledgeBaseMock.mockReset()
    deleteKnowledgeBaseMock.mockReset()
    inviteMemberMock.mockReset()
    listWorkspacesMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads workspace details and creates a knowledge base from the modal', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listKnowledgeBasesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' }])
    createKnowledgeBaseMock.mockResolvedValue({ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' })
    listWorkspacesMock.mockResolvedValue([{ id: 'ws-1', role: 'owner' }])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'New knowledge base' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Knowledge base name'), {
      target: { value: 'Policies' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create knowledge base' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(createKnowledgeBaseMock).toHaveBeenCalledWith('ws-1', 'Policies')
      expect(screen.getByText('Policies')).toBeDefined()
    })
  })

  it('sends invites from the invite form', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listKnowledgeBasesMock.mockResolvedValue([])
    listWorkspacesMock.mockResolvedValue([{ id: 'ws-1', role: 'admin' }])
    inviteMemberMock.mockResolvedValue({ message: 'Invite sent' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined()
    })

    fireEvent.change(screen.getByLabelText('Member email'), {
      target: { value: 'teammate@example.com' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Send invite' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(inviteMemberMock).toHaveBeenCalledWith('ws-1', 'teammate@example.com')
    })
  })

  it('deletes a knowledge base after confirmation', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listKnowledgeBasesMock
      .mockResolvedValueOnce([{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' }])
      .mockResolvedValueOnce([])
    listWorkspacesMock.mockResolvedValue([{ id: 'ws-1', role: 'owner' }])
    deleteKnowledgeBaseMock.mockResolvedValue({ message: 'Deleted' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Policies')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Policies' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete knowledge base' }))

    await waitFor(() => {
      expect(deleteKnowledgeBaseMock).toHaveBeenCalledWith('ws-1', 'kb-1')
    })
  })
})
