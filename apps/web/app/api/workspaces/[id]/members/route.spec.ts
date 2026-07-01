import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/members proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET forwards bearer cookie to /workspaces/:id/members and passes status/body through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockBackendResponse(200, { items: [{ id: 'm-1', userId: 'u-1', email: 'owner@example.com', role: 'owner' }], nextCursor: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/members', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/members', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'm-1', userId: 'u-1', email: 'owner@example.com', role: 'owner' }],
      nextCursor: null,
    })
  })

  it('forwards cursor/limit query params through to the backend URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { items: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/members?cursor=abc&limit=10', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/members?cursor=abc&limit=10',
      expect.any(Object),
    )
  })

  it('missing mnemra_at cookie returns 401 and does not call backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/members')
    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })
})
