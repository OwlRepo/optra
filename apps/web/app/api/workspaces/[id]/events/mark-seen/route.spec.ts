import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('/api/workspaces/[id]/events/mark-seen proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer cookie to /workspaces/:id/events/mark-seen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(204, {}))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/events/mark-seen', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/events/mark-seen',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-access-token' },
      }),
    )
    expect(response.status).toBe(204)
  })
})
