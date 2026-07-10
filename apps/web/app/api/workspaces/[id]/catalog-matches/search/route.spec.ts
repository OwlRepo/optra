import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/catalog-matches/search proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/catalog-matches/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'widget' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { matches: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/catalog-matches/search', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'widget' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/catalog-matches/search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
      body: JSON.stringify({ query: 'widget' }),
    }))
    expect(response.status).toBe(200)
  })
})
