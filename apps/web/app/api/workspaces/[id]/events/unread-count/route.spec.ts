import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('/api/workspaces/[id]/events/unread-count proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer cookie to /workspaces/:id/events/unread-count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { count: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/events/unread-count', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/events/unread-count',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-access-token' },
      }),
    )
    expect(response.status).toBe(200)
  })
})
