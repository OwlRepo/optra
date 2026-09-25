import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyJson, proxyRaw } from './auth-proxy'

function makeRequest(url: string, init?: Omit<RequestInit, 'signal'>) {
  return new NextRequest(url, {
    ...init,
    headers: {
      cookie: 'mnemra_at=test-token',
      ...(init?.headers ?? {}),
    },
  })
}

describe('proxyJson', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards query strings to backend fetch URL', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await proxyJson(
      makeRequest('http://localhost:3000/api/workspaces/ws-1?cursor=abc&limit=10'),
      '/workspaces/ws-1',
      { method: 'GET' },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1?cursor=abc&limit=10',
      expect.any(Object),
    )
  })

  it('keeps bare backend path when request has no query string', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await proxyJson(makeRequest('http://localhost:3000/api/workspaces/ws-1'), '/workspaces/ws-1', {
      method: 'GET',
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1', expect.any(Object))
  })

  it('does not change non-GET body handling', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await proxyJson(makeRequest('http://localhost:3000/api/workspaces?limit=10', { method: 'POST' }), '/workspaces', {
      method: 'POST',
      body: { name: 'Alpha' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces?limit=10',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Alpha' }),
      }),
    )
  })
})

describe('proxyRaw', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards Cache-Control from the backend so photo responses stay cacheable', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(Buffer.from('bytes'), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '5',
          'Cache-Control': 'private, max-age=86400',
        },
      }),
    )

    const response = await proxyRaw(
      makeRequest('http://localhost:3000/api/workspaces/ws-1/catalog-items/item-1/photo'),
      '/workspaces/ws-1/catalog-items/item-1/photo',
      { method: 'GET' },
    )

    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400')
    expect(response.headers.get('Content-Type')).toBe('image/webp')
  })

  // The API marks every download nosniff. Dropped here, the browser would get
  // user-uploaded bytes from our own origin with nothing stopping it sniffing
  // them as HTML - in production Caddy re-adds it; in local dev nothing does.
  it('forwards X-Content-Type-Options so downloads stay nosniff through the proxy', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(Buffer.from('<script>'), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="page.html"',
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    )

    const response = await proxyRaw(
      makeRequest('http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents/doc-1/download'),
      '/workspaces/ws-1/knowledge-bases/kb-1/documents/doc-1/download',
      { method: 'GET' },
    )

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    const response = await proxyRaw(
      new NextRequest('http://localhost:3000/api/workspaces/ws-1/catalog-items/item-1/photo'),
      '/workspaces/ws-1/catalog-items/item-1/photo',
      { method: 'GET' },
    )

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
