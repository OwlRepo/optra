import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0, skus: [] }

describe('/api/workspaces/[id]/vendors/[vendorId]/price-history proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when the access-token cookie is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/price-history')

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }) })

    expect(response.status).toBe(401)
  })

  // The filter and the page number live in the query string, and the proxy
  // forwards it verbatim rather than restating each parameter — so a parameter
  // added to the API later needs no change here.
  it('forwards the query string untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, EMPTY_PAGE))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/vendors/v-1/price-history?sku=DSK-1042&page=2&pageSize=10',
      { headers: { cookie: 'mnemra_at=test-access-token' } },
    )

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/vendors/v-1/price-history?sku=DSK-1042&page=2&pageSize=10',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.status).toBe(200)
  })
})
