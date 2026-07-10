import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('/api/workspaces/[id]/procurement/discrepancies proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies')
    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
  })

  it('forwards bearer cookie and query string to /workspaces/:id/procurement/discrepancies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { flags: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies?status=open', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/discrepancies?status=open',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ flags: [] })
  })
})
