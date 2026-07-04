import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/refine proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine', {
      method: 'POST',
      body: JSON.stringify({ text: 'raw' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })

  it('proxies POST body with bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { original: 'raw', refined: 'clean' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'raw question' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/refine', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'raw question' }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ original: 'raw', refined: 'clean' })
  })

  it('passes through backend 429/422 status and body untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(429, { message: 'Daily refine limit reached' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'raw question' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ message: 'Daily refine limit reached' })
  })
})
