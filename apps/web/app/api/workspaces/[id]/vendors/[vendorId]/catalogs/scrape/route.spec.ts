import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/vendors/[vendorId]/catalogs/scrape proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for POST when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vendor.example.com/catalog' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies POST body with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(202, { id: 'catalog-1', status: 'scraping' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs/scrape', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://vendor.example.com/catalog' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/vendors/v-1/catalogs/scrape', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://vendor.example.com/catalog' }),
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ id: 'catalog-1', status: 'scraping' })
  })
})
