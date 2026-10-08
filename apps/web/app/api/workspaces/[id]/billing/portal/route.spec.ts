import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function backend(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

function portalRequest(workspaceId: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/billing/portal`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

describe('POST /api/workspaces/[id]/billing/portal proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: returns 401 without the access-token cookie', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(portalRequest('ws-1'), { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edge: the workspace id from the path is forwarded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(backend(200, { url: 'https://ls.test/p' }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(portalRequest('ws-7', 'mnemra_at=tok'), { params: Promise.resolve({ id: 'ws-7' }) })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/workspaces/ws-7/billing/portal')
  })

  it('happy: proxies the method, path and bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(backend(200, { url: 'https://ls.test/p' }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(portalRequest('ws-1', 'mnemra_at=tok'), { params: Promise.resolve({ id: 'ws-1' }) })

    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ url: 'https://ls.test/p' })
  })
})
