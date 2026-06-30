/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import KnowledgeBasePage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const listDocumentsMock = vi.fn()
const listScrapeRunsMock = vi.fn()
const scrapeSiteMock = vi.fn()
const uploadDocumentMock = vi.fn()
const deleteDocumentMock = vi.fn()
const listWorkspacesMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/lib/api/documents', () => ({
  listDocuments: (...args: unknown[]) => listDocumentsMock(...args),
  uploadDocument: (...args: unknown[]) => uploadDocumentMock(...args),
  deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
}))

vi.mock('@/lib/api/scrape', () => ({
  listScrapeRuns: (...args: unknown[]) => listScrapeRunsMock(...args),
  scrapeSite: (...args: unknown[]) => scrapeSiteMock(...args),
}))

vi.mock('@/lib/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(KnowledgeBasePage, {
        params: { id: 'ws-1', kbId: 'kb-1' },
      }),
    ),
  )
}

describe('KnowledgeBasePage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    listDocumentsMock.mockReset()
    listScrapeRunsMock.mockReset()
    scrapeSiteMock.mockReset()
    uploadDocumentMock.mockReset()
    deleteDocumentMock.mockReset()
    listWorkspacesMock.mockReset()
    listWorkspacesMock.mockResolvedValue([{ id: 'ws-1', role: 'owner' }])
    listScrapeRunsMock.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders documents with status badges', async () => {
    listDocumentsMock.mockResolvedValue([
      { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
      { id: 'doc-2', title: 'Notes.txt', status: 'failed', createdAt: '2026-06-30T00:00:00.000Z' },
    ])

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    expect(screen.getByText('done')).toBeDefined()
    expect(screen.getByText('failed')).toBeDefined()
  })

  it('uploads a selected file', async () => {
    listDocumentsMock.mockResolvedValue([])
    uploadDocumentMock.mockResolvedValue({ id: 'doc-3', title: 'Upload.txt', status: 'pending' })

    renderPage()

    expect(await screen.findByText('No documents yet')).toBeDefined()

    const file = new File(['hello'], 'Upload.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Upload document'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(uploadDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', file)
      expect(screen.getByText('Upload.txt')).toBeDefined()
      expect(screen.getByText('pending')).toBeDefined()
    })
  })

  it('polls while a document is pending and stops after unmount', async () => {
    vi.useFakeTimers()
    listDocumentsMock
      .mockResolvedValueOnce([
        { id: 'doc-1', title: 'Guide.pdf', status: 'pending', createdAt: '2026-06-30T00:00:00.000Z' },
      ])
      .mockResolvedValue([
        { id: 'doc-1', title: 'Guide.pdf', status: 'processing', createdAt: '2026-06-30T00:00:00.000Z' },
      ])

    const view = renderPage()

    await Promise.resolve()
    await Promise.resolve()

    expect(screen.getByText('pending')).toBeDefined()
    expect(listDocumentsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    await Promise.resolve()
    await Promise.resolve()
    expect(listDocumentsMock).toHaveBeenCalledTimes(2)

    view.unmount()
    const callCount = listDocumentsMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    await Promise.resolve()

    expect(listDocumentsMock).toHaveBeenCalledTimes(callCount)
  })

  it('submits scrape form and renders runs table', async () => {
    listDocumentsMock.mockResolvedValue([])
    listScrapeRunsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'run-1',
          seedUrl: 'https://example.com/docs',
          status: 'queued',
          pagesFound: 0,
          pagesSucceeded: 0,
          pagesFailed: 0,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ])
    scrapeSiteMock.mockResolvedValue({ runId: 'run-1', status: 'queued' })

    renderPage()

    expect(await screen.findByText('No documents yet')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Scrape website' }))
    fireEvent.change(screen.getByLabelText('Website URL'), {
      target: { value: 'https://example.com/docs' },
    })
    fireEvent.change(screen.getByLabelText('Max depth'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Max pages'), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start crawl' }))

    await waitFor(() => {
      expect(scrapeSiteMock).toHaveBeenCalledWith('ws-1', 'kb-1', {
        url: 'https://example.com/docs',
        maxDepth: 2,
        maxPages: 50,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('https://example.com/docs')).toBeDefined()
      expect(screen.getAllByText('queued').length).toBeGreaterThan(0)
    })
  })

  it('polls scrape runs while a crawl is running', async () => {
    vi.useFakeTimers()
    listDocumentsMock.mockResolvedValue([])
    listScrapeRunsMock
      .mockResolvedValueOnce([
        {
          id: 'run-1',
          seedUrl: 'https://example.com/docs',
          status: 'running',
          pagesFound: 3,
          pagesSucceeded: 2,
          pagesFailed: 0,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ])
      .mockResolvedValue([
        {
          id: 'run-1',
          seedUrl: 'https://example.com/docs',
          status: 'completed',
          pagesFound: 3,
          pagesSucceeded: 3,
          pagesFailed: 0,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ])

    const view = renderPage()

    await Promise.resolve()
    await Promise.resolve()

    expect(listScrapeRunsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    await Promise.resolve()
    await Promise.resolve()

    expect(listScrapeRunsMock).toHaveBeenCalledTimes(2)

    view.unmount()
    const callCount = listScrapeRunsMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    await Promise.resolve()

    expect(listScrapeRunsMock).toHaveBeenCalledTimes(callCount)
  })

  it('deletes a document after confirmation', async () => {
    listDocumentsMock
      .mockResolvedValueOnce([
        { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
      ])
      .mockResolvedValueOnce([])
    deleteDocumentMock.mockResolvedValue({ message: 'Deleted' })

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Guide.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))

    await waitFor(() => {
      expect(deleteDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', 'doc-1')
    })
  })
})
