import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockDownloadResponse() {
  return new Response('sku,qty\nA1,2\n', {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="march-po.csv"',
      'Content-Length': '13',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

describe('GET /api/workspaces/[id]/procurement/purchase-orders/[docId]/download proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams the backend download and preserves the filename header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockDownloadResponse())
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/procurement/purchase-orders/doc-1/download',
      { method: 'GET', headers: { cookie: 'mnemra_at=test-access-token' } },
    )

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1', docId: 'doc-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/purchase-orders/doc-1/download',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="march-po.csv"')
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    await expect(response.text()).resolves.toBe('sku,qty\nA1,2\n')
  })

  it('returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(
      new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/purchase-orders/doc-1/download'),
      { params: Promise.resolve({ id: 'ws-1', docId: 'doc-1' }) },
    )

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
