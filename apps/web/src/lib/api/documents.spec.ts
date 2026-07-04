/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadDocument, downloadDocuments, listDocuments } from './documents'

function stubJsonFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubDownloadFetch(filename = 'documents.zip') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Disposition': `attachment; filename="${filename}"` }),
    blob: async () => new Blob(['file bytes']),
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(document.body, 'appendChild')
  vi.spyOn(document.body, 'removeChild')
  return fetchMock
}

describe('documents api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('listDocuments hits the documents endpoint with no query when no options are passed', async () => {
    const fetchMock = stubJsonFetch()

    await listDocuments('ws-1', 'kb-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/knowledge-bases/kb-1/documents',
      expect.any(Object),
    )
  })

  it('listDocuments serializes offset, search, and status filter params', async () => {
    const fetchMock = stubJsonFetch()

    await listDocuments('ws-1', 'kb-1', { page: 2, pageSize: 10, q: 'guide', status: 'done' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/knowledge-bases/kb-1/documents?page=2&pageSize=10&q=guide&status=done',
      expect.any(Object),
    )
  })

  it('downloadDocument fetches the single download endpoint and saves the filename from headers', async () => {
    const fetchMock = stubDownloadFetch('report.txt')

    await downloadDocument('ws-1', 'kb-1', 'doc-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/knowledge-bases/kb-1/documents/doc-1/download',
      expect.objectContaining({ method: 'GET' }),
    )
    const anchor = (document.body.appendChild as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.download).toBe('report.txt')
  })

  it('downloadDocuments posts selected ids to the bulk download endpoint', async () => {
    const fetchMock = stubDownloadFetch()

    await downloadDocuments('ws-1', 'kb-1', ['doc-1', 'doc-2'])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/knowledge-bases/kb-1/documents/download',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: ['doc-1', 'doc-2'] }),
      }),
    )
  })
})
