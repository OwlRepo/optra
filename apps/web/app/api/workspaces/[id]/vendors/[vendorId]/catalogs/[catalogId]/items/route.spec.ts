import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/vendors/[vendorId]/catalogs/[catalogId]/items proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for GET when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs/cat-1/items')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1', catalogId: 'cat-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies GET with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'item-1', sku: 'SKU-1' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs/cat-1/items', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1', catalogId: 'cat-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/vendors/v-1/catalogs/cat-1/items',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-access-token',
        },
        body: undefined,
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'item-1', sku: 'SKU-1' }])
  })
})
