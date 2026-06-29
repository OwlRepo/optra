import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response
}

describe('POST /api/auth/logout proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the cookie to the backend and clears it locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { message: 'Logged out' }))
    vi.stubGlobal('fetch', fetchMock)

    const req = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'mnemra_rt=session-value' },
    })

    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0]
    expect((options.headers as Record<string, string>).Cookie).toBe('mnemra_rt=session-value')

    expect(res.status).toBe(200)
    const clearedCookie = res.headers.get('set-cookie') ?? ''
    expect(clearedCookie).toMatch(/mnemra_rt=;/)
    expect(clearedCookie).toMatch(/mnemra_at=;/)
  })

  it('does not call the backend at all when there is no cookie to begin with', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { message: 'Logged out' }))
    vi.stubGlobal('fetch', fetchMock)

    const req = new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' })
    const res = await POST(req)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})
