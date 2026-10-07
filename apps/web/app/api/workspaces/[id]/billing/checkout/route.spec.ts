import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function backend(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

function checkoutRequest(workspaceId: string, cookie?: string, body: unknown = { plan: 'team', seats: 3 }) {
  return new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/billing/checkout`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  })
}

describe('POST /api/workspaces/[id]/billing/checkout proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: returns 401 without the access-token cookie', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(checkoutRequest('ws-1'), { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edge: the workspace id from the path is forwarded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(backend(201, { url: 'https://ls.test/c' }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(checkoutRequest('ws-9', 'mnemra_at=tok'), { params: Promise.resolve({ id: 'ws-9' }) })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/workspaces/ws-9/billing/checkout')
  })

  it('happy: proxies the method, path, bearer and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(backend(201, { url: 'https://ls.test/c' }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(checkoutRequest('ws-1', 'mnemra_at=tok'), { params: Promise.resolve({ id: 'ws-1' }) })

    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ plan: 'team', seats: 3 }))
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ url: 'https://ls.test/c' })
  })
})
