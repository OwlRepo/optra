import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('/api/workspaces/[id]/events proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer cookie and cursor params to /workspaces/:id/events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { items: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/events?cursor=abc&limit=10', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/events?cursor=abc&limit=10',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-access-token' },
      }),
    )
    expect(response.status).toBe(200)
  })
})
