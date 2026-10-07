import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const params = Promise.resolve({ id: 'ws-1', docId: 'doc-1', n: '2' })
const URL = 'http://localhost:3000/api/workspaces/ws-1/procurement/goods-receipts/doc-1/pages/2'

describe('GET /api/workspaces/[id]/procurement/goods-receipts/[docId]/pages/[n] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(new NextRequest(URL), { params })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: passes a backend 404 status through without turning it into an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })),
    )

    const response = await GET(new NextRequest(URL, { headers: { cookie: 'mnemra_at=test-access-token' } }), { params })

    expect(response.status).toBe(404)
  })

  it('edge: keeps the sandbox CSP, nosniff and the private cache header the API set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('jpeg-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cache-Control': 'private, max-age=86400',
          },
        }),
      ),
    )

    const response = await GET(new NextRequest(URL, { headers: { cookie: 'mnemra_at=test-access-token' } }), { params })

    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400')
  })

  it('happy: streams the page image from the pages path with the bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('jpeg-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(new NextRequest(URL, { headers: { cookie: 'mnemra_at=test-access-token' } }), { params })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/goods-receipts/doc-1/pages/2',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    await expect(response.text()).resolves.toBe('jpeg-bytes')
  })
})
