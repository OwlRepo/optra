import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/refine/saved proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for GET when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine/saved')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('returns 401 for POST when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine/saved', {
      method: 'POST',
      body: JSON.stringify({ originalText: 'a', refinedText: 'b' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('lists saved messages via GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockBackendResponse(200, { items: [{ id: 'm-1', originalText: 'a', refinedText: 'b', createdAt: '2026-07-04' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine/saved', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/refine/saved', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'm-1', originalText: 'a', refinedText: 'b', createdAt: '2026-07-04' }],
    })
  })

  it('saves a message via POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockBackendResponse(201, { id: 'm-1', originalText: 'a', refinedText: 'b', createdAt: '2026-07-04' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/refine/saved', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ originalText: 'a', refinedText: 'b' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/refine/saved', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ originalText: 'a', refinedText: 'b' }),
    })
    expect(response.status).toBe(201)
  })
})
