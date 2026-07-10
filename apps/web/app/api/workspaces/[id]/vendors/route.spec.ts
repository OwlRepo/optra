import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/vendors proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for GET when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies GET with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'vendor-1', name: 'Acme Supply' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/vendors', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'vendor-1', name: 'Acme Supply' }])
  })

  it('returns 401 for POST when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme Supply' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies POST body with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { id: 'vendor-1', name: 'Acme Supply' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Supply' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/vendors', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Acme Supply' }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'vendor-1', name: 'Acme Supply' })
  })
})
