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
const downloadDocumentMock = vi.fn()
const downloadDocumentsMock = vi.fn()
const listWorkspacesMock = vi.fn()
const getWorkspaceMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/knowledge-bases/kb-1',
}))

vi.mock('@/lib/api/documents', () => ({
  listDocuments: (...args: unknown[]) => listDocumentsMock(...args),
  uploadDocument: (...args: unknown[]) => uploadDocumentMock(...args),
  deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
  downloadDocument: (...args: unknown[]) => downloadDocumentMock(...args),
  downloadDocuments: (...args: unknown[]) => downloadDocumentsMock(...args),
}))

vi.mock('@/lib/api/scrape', () => ({
  listScrapeRuns: (...args: unknown[]) => listScrapeRunsMock(...args),
  scrapeSite: (...args: unknown[]) => scrapeSiteMock(...args),
}))

vi.mock('@/lib/api/workspaces', () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
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

function offsetResponse<T>(items: T[], overrides?: Partial<{ page: number; pageSize: number; total: number; totalPages: number }>) {
  const page = overrides?.page ?? 1
  const pageSize = overrides?.pageSize ?? 20
  const total = overrides?.total ?? items.length
  const totalPages = overrides?.totalPages ?? (total === 0 ? 0 : Math.ceil(total / pageSize))
  return { items, page, pageSize, total, totalPages }
}

describe('KnowledgeBasePage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    listDocumentsMock.mockReset()
    listScrapeRunsMock.mockReset()
    scrapeSiteMock.mockReset()
    uploadDocumentMock.mockReset()
    deleteDocumentMock.mockReset()
    downloadDocumentMock.mockReset()
    downloadDocumentsMock.mockReset()
    listWorkspacesMock.mockReset()
    getWorkspaceMock.mockReset()
    logoutMock.mockReset()
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme Support' })
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

  it('uploads a dropped file through the same upload handler', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([]))
    uploadDocumentMock.mockResolvedValue({ id: 'doc-3', title: 'Dropped.txt', status: 'pending' })

    renderPage()

    expect(await screen.findByText('No documents yet')).toBeDefined()

    const file = new File(['hello'], 'Dropped.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('document-dropzone'), {
      dataTransfer: { files: [file] },
    })

    await waitFor(() => {
      expect(uploadDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', file)
      expect(screen.getByText('Dropped.txt')).toBeDefined()
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

  it('submits scrape form and renders runs table with in-progress status', async () => {
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
      expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
    })
  })

  it('autofocuses scrape url input and keeps focus while typing', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText('No documents yet')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Scrape website' }))
    const input = screen.getByLabelText('Website URL') as HTMLInputElement

    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })

    fireEvent.change(input, { target: { value: 'https://example.com/d' } })
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'https://example.com/docs' } })
    expect(document.activeElement).toBe(input)
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

  it('shows in-progress crawl status separately from labeled page counts', async () => {
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
          seedUrl: 'https://example.com/queued',
          status: 'queued',
          pagesFound: 0,
          pagesSucceeded: 0,
          pagesFailed: 0,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
        {
          id: 'run-3',
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

    expect(await screen.findAllByText('In progress')).toHaveLength(2)
    expect(screen.getByText('Completed')).toBeDefined()
    expect(screen.getByText('Found 10 · Queued 4 · Page errors 1')).toBeDefined()
    expect(screen.getByText('Found 0 · Queued 0 · Page errors 0')).toBeDefined()
    expect(screen.getByText('Found 3 · Queued 3 · Page errors 0')).toBeDefined()
    expect(screen.getByText('50% of discovered pages processed')).toBeDefined()
    expect(screen.getByText('100% of discovered pages processed')).toBeDefined()
  })

  it('shows truthful document queue summary and keeps backend newest-first order', async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        { id: 'doc-failed', title: 'Failed.txt', status: 'failed', createdAt: '2026-06-30T00:00:03.000Z', updatedAt: '2026-06-30T00:00:20.000Z' },
        { id: 'doc-processing', title: 'Processing.txt', status: 'processing', createdAt: '2026-06-30T00:00:02.000Z', updatedAt: '2026-06-30T00:00:15.000Z' },
        { id: 'doc-pending', title: 'Pending.txt', status: 'pending', createdAt: '2026-06-30T00:00:01.000Z', updatedAt: '2026-06-30T00:00:10.000Z' },
        { id: 'doc-done', title: 'Done.txt', status: 'done', createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:05.000Z' },
      ],
      nextCursor: null,
    })
    listScrapeRunsMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('2 documents in flight')).toBeDefined()
    expect(screen.getByText('25% indexed · 1 pending · 1 processing · 1 failed')).toBeDefined()

    const rows = screen.getAllByRole('row')
    expect(rows[1]?.textContent).toContain('Failed.txt')
    expect(rows[2]?.textContent).toContain('Processing.txt')
  })

  // Regression: ISSUE-002 — document queue summary rendered as a <div> inside
  // <TableHeader> (<thead>), which only permits <tr> children. Caused a React
  // hydration warning ("In HTML, %s cannot be a child of <%s>") on every render.
  // Found by /qa on 2026-07-02
  // Report: .gstack/qa-reports/qa-report-localhost-2026-07-02.md
  it('renders the document queue summary outside the table head, not as an invalid child', async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        { id: 'doc-done', title: 'Done.txt', status: 'done', createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:05.000Z' },
        { id: 'doc-pending', title: 'Pending.txt', status: 'pending', createdAt: '2026-06-30T00:00:01.000Z', updatedAt: '2026-06-30T00:00:10.000Z' },
      ],
      nextCursor: null,
    })
    listScrapeRunsMock.mockResolvedValue([])

    const { container } = renderPage()

    await screen.findByText('1 document in flight')

    const thead = container.querySelector('thead')
    expect(thead).not.toBeNull()
    expect(Array.from(thead!.children).every((child) => child.tagName === 'TR')).toBe(true)
    expect(thead!.textContent).not.toContain('in flight')
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

  it('paginates documents through the backend', async () => {
    listDocumentsMock.mockResolvedValue(
      offsetResponse(
        [
          { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
        ],
        { page: 1, pageSize: 20, total: 40, totalPages: 2 },
      ),
    )

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(listDocumentsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ page: 2 }))
    })
  })

  it('searches and filters documents through the backend', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([
      { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
    ]))

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'guide' } })

    await waitFor(() => {
      expect(listDocumentsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ q: 'guide' }))
    })

    fireEvent.change(screen.getByLabelText('Filter documents by status'), { target: { value: 'done' } })

    await waitFor(() => {
      expect(listDocumentsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ status: 'done' }))
    })
  })

  it('downloads a single document from the row action', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([
      { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
    ]))
    downloadDocumentMock.mockResolvedValue(undefined)

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Download Guide.pdf' }))

    await waitFor(() => {
      expect(downloadDocumentMock).toHaveBeenCalledWith('ws-1', 'kb-1', 'doc-1')
    })
  })

  it('downloads selected documents in bulk', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([
      { id: 'doc-1', title: 'Guide.pdf', status: 'done', createdAt: '2026-06-30T00:00:00.000Z' },
      { id: 'doc-2', title: 'Notes.txt', status: 'done', createdAt: '2026-06-30T00:00:01.000Z' },
    ]))
    downloadDocumentsMock.mockResolvedValue(undefined)

    renderPage()

    expect(await screen.findByText('Guide.pdf')).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Guide.pdf' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Notes.txt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download selected' }))

    await waitFor(() => {
      expect(downloadDocumentsMock).toHaveBeenCalledWith('ws-1', 'kb-1', ['doc-1', 'doc-2'])
    })
  })

  it('renders workspace nav and keeps knowledge bases active', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findByRole('link', { name: 'Knowledge Bases' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Knowledge Bases' }).getAttribute('aria-current')).toBe('page')
  })

  it('renders scrape website action in top bar', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findByRole('button', { name: 'Scrape website' })).toBeDefined()
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

  it('paginates crawl runs through the backend', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([]))
    listScrapeRunsMock.mockResolvedValue(
      offsetResponse(
        [
          {
            id: 'run-1',
            seedUrl: 'https://example.com/newest',
            status: 'completed',
            pagesFound: 3,
            pagesSucceeded: 3,
            pagesFailed: 0,
            createdAt: '2026-06-30T00:00:02.000Z',
          },
        ],
        { page: 1, pageSize: 5, total: 10, totalPages: 2 },
      ),
    )

    renderPage()

    expect(await screen.findByText('https://example.com/newest')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0])

    await waitFor(() => {
      expect(listScrapeRunsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ page: 2 }))
    })
  })

  it('searches and filters crawl runs through the backend', async () => {
    listDocumentsMock.mockResolvedValue(offsetResponse([]))
    listScrapeRunsMock.mockResolvedValue(offsetResponse([
      {
        id: 'run-1',
        seedUrl: 'https://example.com/newest',
        status: 'running',
        pagesFound: 3,
        pagesSucceeded: 1,
        pagesFailed: 0,
        createdAt: '2026-06-30T00:00:02.000Z',
      },
    ]))

    renderPage()

    expect(await screen.findByText('https://example.com/newest')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search crawl runs'), { target: { value: 'example' } })

    await waitFor(() => {
      expect(listScrapeRunsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ q: 'example' }))
    })

    fireEvent.change(screen.getByLabelText('Filter crawl runs by status'), { target: { value: 'running' } })

    await waitFor(() => {
      expect(listScrapeRunsMock).toHaveBeenCalledWith('ws-1', 'kb-1', expect.objectContaining({ status: 'running' }))
    })
  })

  it('renders real workspace name in sidebar header', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })

    renderPage()

    expect(await screen.findAllByText('Acme Support')).not.toHaveLength(0)
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('redirects to login when workspace fetch is unauthorized', async () => {
    listDocumentsMock.mockResolvedValue({ items: [], nextCursor: null })
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
