/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import KnowledgeBasesPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listKnowledgeBasesMock = vi.fn()
const createKnowledgeBaseMock = vi.fn()
const deleteKnowledgeBaseMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/knowledge-bases',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

vi.mock('@/lib/api/knowledge-bases', () => ({
  listKnowledgeBases: (...args: unknown[]) => listKnowledgeBasesMock(...args),
  createKnowledgeBase: (...args: unknown[]) => createKnowledgeBaseMock(...args),
  deleteKnowledgeBase: (...args: unknown[]) => deleteKnowledgeBaseMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(KnowledgeBasesPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('KnowledgeBasesPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listKnowledgeBasesMock.mockReset()
    createKnowledgeBaseMock.mockReset()
    deleteKnowledgeBaseMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched knowledge bases', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listKnowledgeBasesMock.mockResolvedValue({
      items: [{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1', createdAt: '2026-07-01T00:00:00.000Z' }],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Policies')).toBeDefined()
  })

  it('renders empty state with manager action and hides it for plain member', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listKnowledgeBasesMock.mockResolvedValue({ items: [], nextCursor: null })
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    const view = renderPage()

    expect(await screen.findByText('No knowledge bases yet')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'New knowledge base' }).length).toBeGreaterThan(0)

    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })
    renderPage()

    expect(await screen.findByText('No knowledge bases yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New knowledge base' })).toBeNull()
  })

  it('creates knowledge base from modal and reloads list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listKnowledgeBasesMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' }], nextCursor: null })
    createKnowledgeBaseMock.mockResolvedValue({ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' })

    renderPage()

    await screen.findByText('No knowledge bases yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'New knowledge base' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Knowledge base name'), { target: { value: 'Policies' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create knowledge base' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(createKnowledgeBaseMock).toHaveBeenCalledWith('ws-1', 'Policies')
      expect(screen.getByText('Policies')).toBeDefined()
    })
  })

  it('deletes knowledge base after confirmation and reloads list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listKnowledgeBasesMock
      .mockResolvedValueOnce({ items: [{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    deleteKnowledgeBaseMock.mockResolvedValue({ message: 'Deleted' })

    renderPage()

    await screen.findByText('Policies')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Policies' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete knowledge base' }))

    await waitFor(() => {
      expect(deleteKnowledgeBaseMock).toHaveBeenCalledWith('ws-1', 'kb-1')
    })
  })

  it('shows create controls only for owner and admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listKnowledgeBasesMock.mockResolvedValue({ items: [], nextCursor: null })
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'admin' })

    const view = renderPage()

    expect((await screen.findAllByRole('button', { name: 'New knowledge base' })).length).toBeGreaterThan(0)
    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })
    renderPage()

    expect(await screen.findByText('No knowledge bases yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New knowledge base' })).toBeNull()
  })

  it('loads more knowledge bases without duplicating existing rows', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listKnowledgeBasesMock
      .mockResolvedValueOnce({
        items: [{ id: 'kb-1', name: 'Policies', workspaceId: 'ws-1' }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'kb-2', name: 'Playbooks', workspaceId: 'ws-1' }],
        nextCursor: null,
      })

    renderPage()

    expect(await screen.findByText('Policies')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Load more knowledge bases' }))

    await waitFor(() => {
      expect(listKnowledgeBasesMock).toHaveBeenNthCalledWith(2, 'ws-1', { cursor: 'cursor-1' })
      expect(screen.getByText('Playbooks')).toBeDefined()
    })
  })

  it('redirects to login on unauthorized load/create/delete errors', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listKnowledgeBasesMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
