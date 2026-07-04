import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockDownloadResponse() {
  return new Response('file bytes', {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="report.txt"',
      'Content-Length': '10',
    },
  })
}

describe('GET /api/workspaces/[id]/knowledge-bases/[kbId]/documents/[docId]/download proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams the backend download and preserves content headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockDownloadResponse())
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents/doc-1/download',
      {
        method: 'GET',
        headers: { cookie: 'mnemra_at=test-access-token' },
      },
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1', docId: 'doc-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/documents/doc-1/download',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test-access-token' },
        body: undefined,
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="report.txt"')
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    await expect(response.text()).resolves.toBe('file bytes')
  })
})
