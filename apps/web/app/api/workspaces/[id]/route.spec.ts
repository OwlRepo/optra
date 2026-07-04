import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for GET when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('returns 401 for PATCH when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    })
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies PATCH body with bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockBackendResponse(200, { id: 'ws-1', name: 'New Name', ownerId: 'u-1', createdAt: '' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1', {
      method: 'PATCH',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'ws-1', name: 'New Name', ownerId: 'u-1', createdAt: '' })
  })
})
