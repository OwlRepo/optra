import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/tickets proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/tickets')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })

  it('proxies POST transcript body with bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(202, { id: 'ticket-1', status: 'pending' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/tickets', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: 'Customer says login loops.' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/tickets', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: 'Customer says login loops.' }),
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ id: 'ticket-1', status: 'pending' })
  })
})
