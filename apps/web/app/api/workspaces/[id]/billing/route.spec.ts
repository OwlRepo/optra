import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function backend(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

describe('GET /api/workspaces/[id]/billing proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: returns 401 without the access-token cookie', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/billing', { method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edge: the workspace id from the path is forwarded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(backend(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-42/billing', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=tok' },
    })

    await GET(request, { params: Promise.resolve({ id: 'ws-42' }) })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/workspaces/ws-42/billing')
  })

  it('happy: proxies the method, path and bearer, and returns the backend payload', async () => {
    const payload = { state: 'trialing', enforced: false }
    const fetchMock = vi.fn().mockResolvedValue(backend(200, payload))
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/billing', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=tok' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
  })
})
