import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/workspaces/[id]/knowledge-bases/[kbId]/documents/delete proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards selected document ids and returns deletion counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: 2, skipped: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents/delete',
      {
        method: 'POST',
        headers: {
          cookie: 'mnemra_at=test-access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentIds: ['doc-1', 'doc-2', 'doc-3'] }),
      },
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/documents/delete',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentIds: ['doc-1', 'doc-2', 'doc-3'] }),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deleted: 2, skipped: 1 })
  })
})
