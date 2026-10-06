import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const params = Promise.resolve({ id: 'ws-1', docId: 'doc-1' })
const URL = 'http://localhost:3000/api/workspaces/ws-1/procurement/purchase-orders/doc-1/lines'

describe('GET /api/workspaces/[id]/procurement/purchase-orders/[docId]/lines proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('error: returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    const response = await GET(new NextRequest(URL), { params })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: passes a backend 404 through', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }),
    )

    const response = await GET(new NextRequest(URL, { headers: { cookie: 'mnemra_at=test-token' } }), { params })

    expect(response.status).toBe(404)
  })

  it('edge: keeps a bare path when the request has no query string', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await GET(new NextRequest(URL, { headers: { cookie: 'mnemra_at=test-token' } }), { params })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3001/workspaces/ws-1/procurement/purchase-orders/doc-1/lines')
  })

  it('happy: forwards the page and pageSize query to the lines path with the bearer', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], page: 2, pageSize: 50, total: 0, totalPages: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const response = await GET(
      new NextRequest(`${URL}?page=2&pageSize=50`, { headers: { cookie: 'mnemra_at=test-token' } }),
      { params },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/purchase-orders/doc-1/lines?page=2&pageSize=50',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    )
    expect(response.status).toBe(200)
  })
})
