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
const logoutMock = vi.fn()

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

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
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
    logoutMock.mockReset()
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listScrapeRunsMock.mockResolvedValue({ items: [], nextCursor: null })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders documents with status badges', async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
        { id: 'doc-2', title: 'Notes.txt', status: 'failed', createdAt: '2026-06-30T00:00:00.000Z' },
      ],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    expect(screen.getByText('done')).toBeDefined()
    expect(screen.getByText('failed')).toBeDefined()
  })

  it('uploads a selected file', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
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
      .mockResolvedValueOnce({
        items: [
          { id: 'doc-1', title: 'Guide.pdf', status: 'pending', createdAt: '2026-06-30T00:00:00.000Z' },
        ],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [
          { id: 'doc-1', title: 'Guide.pdf', status: 'processing', createdAt: '2026-06-30T00:00:00.000Z' },
        ],
        nextCursor: null,
      })

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
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    listScrapeRunsMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/docs',
            status: 'queued',
            pagesFound: 0,
            pagesSucceeded: 0,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      })
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

  it('disables the crawl submit button while the request is in flight and shows duplicate-run feedback', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    listScrapeRunsMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/docs',
            status: 'queued',
            pagesFound: 0,
            pagesSucceeded: 0,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      })

    let resolveScrape: ((value: unknown) => void) | undefined
    scrapeSiteMock.mockReturnValue(
      new Promise((resolve) => {
        resolveScrape = resolve
      }),
    )

    renderPage()

    expect(await screen.findByText('No documents yet')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Scrape website' }))
    fireEvent.change(screen.getByLabelText('Website URL'), {
      target: { value: 'https://example.com/docs' },
    })

    const startButton = screen.getByRole('button', { name: 'Start crawl' }) as HTMLButtonElement
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(startButton.disabled).toBe(true)
    })

    resolveScrape?.({
      runId: 'run-1',
      status: 'queued',
      reusedExisting: true,
    })

    await waitFor(() => {
      expect(screen.getByText('Crawl already in progress')).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Start crawl' })).toBeNull()
    })
  })

  it('polls scrape runs while a crawl is running', async () => {
    vi.useFakeTimers()
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    listScrapeRunsMock
      .mockResolvedValueOnce({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/docs',
            status: 'running',
            pagesFound: 3,
            pagesSucceeded: 2,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/docs',
            status: 'completed',
            pagesFound: 3,
            pagesSucceeded: 3,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      })

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

  it('shows discovered-page progress text for running and completed crawls', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    listScrapeRunsMock.mockResolvedValue({
      items: [
        {
          id: 'run-1',
          seedUrl: 'https://example.com/docs',
          status: 'running',
          pagesFound: 10,
          pagesSucceeded: 4,
          pagesFailed: 1,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
        {
          id: 'run-2',
          seedUrl: 'https://example.com/done',
          status: 'completed',
          pagesFound: 3,
          pagesSucceeded: 3,
          pagesFailed: 0,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('50% of discovered pages processed')).toBeDefined()
    expect(screen.getByText('100% of discovered pages processed')).toBeDefined()
  })

  it('shows truthful document queue summary and surfaces in-flight docs first', async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        { id: 'doc-done', title: 'Done.txt', status: 'done', createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:05.000Z' },
        { id: 'doc-pending', title: 'Pending.txt', status: 'pending', createdAt: '2026-06-30T00:00:01.000Z', updatedAt: '2026-06-30T00:00:10.000Z' },
        { id: 'doc-processing', title: 'Processing.txt', status: 'processing', createdAt: '2026-06-30T00:00:02.000Z', updatedAt: '2026-06-30T00:00:15.000Z' },
        { id: 'doc-failed', title: 'Failed.txt', status: 'failed', createdAt: '2026-06-30T00:00:03.000Z', updatedAt: '2026-06-30T00:00:20.000Z' },
      ],
      nextCursor: null,
    })
    listScrapeRunsMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('2 documents in flight')).toBeDefined()
    expect(screen.getByText('25% indexed · 1 pending · 1 processing · 1 failed')).toBeDefined()

    const rows = screen.getAllByRole('row')
    expect(rows[1]?.textContent).toContain('Processing.txt')
    expect(rows[2]?.textContent).toContain('Pending.txt')
  })

  it('deletes a document after confirmation', async () => {
    listDocumentsMock
      .mockResolvedValueOnce({
        items: [
          { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    deleteDocumentMock.mockResolvedValue({ message: 'Deleted' })

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Guide.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))

    await waitFor(() => {
      expect(deleteDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', 'doc-1')
    })
  })

  it('renders load more button and appends next page rows', async () => {
    listDocumentsMock
      .mockResolvedValueOnce({
        items: [
          { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
          { id: 'doc-2', title: 'Notes.txt', status: 'done', createdAt: '2026-06-30T00:00:01.000Z' },
        ],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'doc-3', title: 'Appendix.txt', status: 'done', createdAt: '2026-06-30T00:00:02.000Z' },
        ],
        nextCursor: null,
      })

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Load more documents' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Load more documents' }))

    await waitFor(() => {
      expect(listDocumentsMock).toHaveBeenNthCalledWith(2, 'ws-1', 'kb-1', { cursor: 'cursor-1' })
      expect(screen.getByText('Appendix.txt')).toBeDefined()
    })
  })

  it('hides load more button when documents nextCursor is null', async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
      ],
      nextCursor: null,
    })

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Load more documents' })).toBeNull()
  })

  it('renders all workspaces link alongside back to workspace', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect((await screen.findByRole('link', { name: 'All workspaces' })).getAttribute('href')).toBe('/workspaces')
    expect(screen.getByRole('link', { name: 'Back to workspace' }).getAttribute('href')).toBe('/workspaces/ws-1')
  })

  it('logs out and redirects to login', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    logoutMock.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('renders load more crawl runs and polling refresh resets to first page', async () => {
    vi.useFakeTimers()
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    listScrapeRunsMock
      .mockResolvedValueOnce({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/newest',
            status: 'running',
            pagesFound: 3,
            pagesSucceeded: 1,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:02.000Z',
          },
        ],
        nextCursor: 'run-cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'run-2',
            seedUrl: 'https://example.com/older',
            status: 'completed',
            pagesFound: 3,
            pagesSucceeded: 3,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:01.000Z',
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/newest',
            status: 'running',
            pagesFound: 4,
            pagesSucceeded: 2,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:02.000Z',
          },
        ],
        nextCursor: 'run-cursor-1',
      })

    renderPage()

    await Promise.resolve()
    await Promise.resolve()

    expect(screen.getByText('https://example.com/newest')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Load more crawl runs' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Load more crawl runs' }))

    await Promise.resolve()
    await Promise.resolve()

    expect(listScrapeRunsMock).toHaveBeenNthCalledWith(2, 'ws-1', 'kb-1', {
      cursor: 'run-cursor-1',
    })
    expect(screen.getByText('https://example.com/older')).toBeDefined()

    await vi.advanceTimersByTimeAsync(3000)
    await Promise.resolve()
    await Promise.resolve()

    expect(listScrapeRunsMock).toHaveBeenNthCalledWith(3, 'ws-1', 'kb-1')
  })
})
