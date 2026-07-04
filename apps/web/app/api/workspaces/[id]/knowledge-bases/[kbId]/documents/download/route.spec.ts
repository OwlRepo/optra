import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/workspaces/[id]/knowledge-bases/[kbId]/documents/download proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards selected document ids and streams the zip response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('zip bytes', {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="documents.zip"',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents/download',
      {
        method: 'POST',
        headers: {
          cookie: 'mnemra_at=test-access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentIds: ['doc-1', 'doc-2'] }),
      },
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/documents/download',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentIds: ['doc-1', 'doc-2'] }),
      },
    )
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="documents.zip"')
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    await expect(response.text()).resolves.toBe('zip bytes')
  })
})
