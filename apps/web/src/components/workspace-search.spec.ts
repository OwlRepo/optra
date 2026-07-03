/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSearch } from './workspace-search'

const pushMock = vi.fn()
const searchWorkspaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/search', () => ({
  searchWorkspace: (...args: unknown[]) => searchWorkspaceMock(...args),
}))

describe('WorkspaceSearch', () => {
  beforeEach(() => {
    pushMock.mockReset()
    searchWorkspaceMock.mockReset()
    searchWorkspaceMock.mockResolvedValue({ documents: [], tickets: [], chatMessages: [] })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('pressing cmd+k opens the search modal and autofocuses query input', async () => {
    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(screen.getByRole('dialog', { name: 'Search workspace' })).toBeTruthy()

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Search query'))
    })
  })

  it('typing keeps focus on the search input and calls search after debounce', async () => {
    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    const input = screen.getByLabelText('Search query') as HTMLInputElement

    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })

    fireEvent.change(input, { target: { value: 'o' } })
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'otp' } })
    expect(document.activeElement).toBe(input)

    await new Promise((resolve) => setTimeout(resolve, 350))

    await waitFor(() => {
      expect(searchWorkspaceMock).toHaveBeenCalledWith('ws-1', 'otp')
    })
  })

  it('renders grouped sections and clicking a result navigates to the correct destination', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [{ documentId: 'doc-1', knowledgeBaseId: 'kb-1', title: 'Runbook', snippet: 'OTP fix', score: 0.9 }],
      tickets: [{ ticketId: 't-1', title: 'OTP login loop', snippet: 'summary', score: 0.8 }],
      chatMessages: [{ messageId: 'm-1', sessionId: 's-1', snippet: 'OTP answer', score: 0.7 }],
    })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(await screen.findByText('Documents')).toBeDefined()
    expect(screen.getByText('Tickets')).toBeDefined()
    expect(screen.getByText('Chat Messages')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Runbook' }))
    expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/knowledge-bases/kb-1')
  })

  it('renders empty query and zero-results states', async () => {
    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    expect(screen.getByText('Start typing to search documents, tickets, and chat history.')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'nothing' } })
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(await screen.findByText('No matches found.')).toBeDefined()
  })
})
