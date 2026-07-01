import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyJson } from './auth-proxy'

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
