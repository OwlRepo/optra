import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('/api/workspaces/[id]/search proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer cookie and query string to /workspaces/:id/search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { documents: [], tickets: [], chatMessages: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/search?q=otp', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/search?q=otp',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-access-token' },
      }),
    )
    expect(response.status).toBe(200)
  })
})
