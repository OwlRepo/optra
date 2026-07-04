/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSearch } from './workspace-search'

const pushMock = vi.fn()
const searchWorkspaceMock = vi.fn()
const downloadDocumentMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/search', () => ({
  searchWorkspace: (...args: unknown[]) => searchWorkspaceMock(...args),
}))

vi.mock('@/lib/api/documents', () => ({
  downloadDocument: (...args: unknown[]) => downloadDocumentMock(...args),
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('WorkspaceSearch', () => {
  beforeEach(() => {
    pushMock.mockReset()
    searchWorkspaceMock.mockReset()
    downloadDocumentMock.mockReset()
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

  it('renders the modal at full (80vw) size so more results are visible', async () => {
    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))

    expect(screen.getByRole('dialog').className).toContain('80vw')
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

    await sleep(350)

    await waitFor(() => {
      expect(searchWorkspaceMock).toHaveBeenCalledWith('ws-1', 'otp', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    })
  })

  it('shows a loading spinner while the search is in flight', async () => {
    let resolveSearch: (value: unknown) => void = () => {}
    searchWorkspaceMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSearch = resolve }),
    )

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    expect(await screen.findByText('Searching…')).toBeDefined()

    resolveSearch({ documents: [], tickets: [], chatMessages: [] })

    await waitFor(() => {
      expect(screen.queryByText('Searching…')).toBeNull()
    })
  })

  it('shows an error state when the search request fails', async () => {
    searchWorkspaceMock.mockRejectedValueOnce(new Error('boom'))

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    expect(await screen.findByText('Search failed')).toBeDefined()
  })

  it('cancels a stale in-flight request so an older response cannot overwrite newer results', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve })

    searchWorkspaceMock
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce({
        documents: [{ documentId: 'doc-2', knowledgeBaseId: 'kb-2', title: 'Second Result', snippet: 'x', score: 0.5 }],
        tickets: [],
        chatMessages: [],
      })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    const input = screen.getByLabelText('Search query')

    fireEvent.change(input, { target: { value: 'first' } })
    await sleep(350)

    fireEvent.change(input, { target: { value: 'second' } })
    await sleep(350)

    expect(await screen.findByText('Second Result')).toBeDefined()

    resolveFirst({
      documents: [{ documentId: 'doc-1', knowledgeBaseId: 'kb-1', title: 'First (stale)', snippet: 'x', score: 0.9 }],
      tickets: [],
      chatMessages: [],
    })
    await sleep(10)

    expect(screen.getByText('Second Result')).toBeDefined()
    expect(screen.queryByText('First (stale)')).toBeNull()
  })

  it('renders grouped sections', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [{ documentId: 'doc-1', knowledgeBaseId: 'kb-1', title: 'Runbook', snippet: 'OTP fix', score: 0.9 }],
      tickets: [{ ticketId: 't-1', title: 'OTP login loop', snippet: 'summary', score: 0.8 }],
      chatMessages: [{ messageId: 'm-1', sessionId: 's-1', snippet: 'OTP answer', score: 0.7 }],
    })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    expect(await screen.findByText('Documents')).toBeDefined()
    expect(screen.getByText('Tickets')).toBeDefined()
    expect(screen.getByText('Chat Messages')).toBeDefined()
  })

  it('clicking a document without a sourceUrl downloads the file instead of navigating', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [{ documentId: 'doc-1', knowledgeBaseId: 'kb-1', title: 'Runbook', snippet: 'OTP fix', score: 0.9 }],
      tickets: [],
      chatMessages: [],
    })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    fireEvent.click(await screen.findByRole('button', { name: 'Runbook' }))

    expect(downloadDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', 'doc-1')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('clicking a document with a sourceUrl opens it in a new tab instead of downloading', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [{
        documentId: 'doc-1',
        knowledgeBaseId: 'kb-1',
        title: 'Crawled Page',
        sourceUrl: 'https://docs.example.com/page',
        snippet: 'x',
        score: 0.9,
      }],
      tickets: [],
      chatMessages: [],
    })
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    fireEvent.click(await screen.findByRole('button', { name: 'Crawled Page' }))

    expect(windowOpenSpy).toHaveBeenCalledWith('https://docs.example.com/page', '_blank', 'noreferrer')
    expect(downloadDocumentMock).not.toHaveBeenCalled()
  })

  it('clicking a ticket result navigates to the tickets page', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [],
      tickets: [{ ticketId: 't-1', title: 'OTP login loop', snippet: 'summary', score: 0.8 }],
      chatMessages: [],
    })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    fireEvent.click(await screen.findByRole('button', { name: 'OTP login loop' }))

    expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/tickets')
  })

  it('clicking a chat history result opens that specific session', async () => {
    searchWorkspaceMock.mockResolvedValue({
      documents: [],
      tickets: [],
      chatMessages: [{ messageId: 'm-1', sessionId: 's-1', snippet: 'OTP answer', score: 0.7 }],
    })

    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'otp' } })
    await sleep(350)

    fireEvent.click(await screen.findByRole('button', { name: 'Chat match' }))

    expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/chat?session=s-1')
  })

  it('renders empty query and zero-results states', async () => {
    render(React.createElement(WorkspaceSearch, { workspaceId: 'ws-1', collapsed: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }))
    expect(screen.getByText('Start typing to search documents, tickets, and chat history.')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'nothing' } })
    await sleep(350)

    expect(await screen.findByText('No matches found.')).toBeDefined()
  })
})
