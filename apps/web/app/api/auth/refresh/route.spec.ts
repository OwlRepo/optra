import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response
}

describe('POST /api/auth/refresh proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the rotated Set-Cookie header from the backend back to the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(200, { accessToken: 'fake-token' }, {
          'set-cookie': 'mnemra_rt=new-rotated-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'mnemra_rt=old-value' },
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('mnemra_rt=new-rotated-value')
  })

  it('forwards the incoming mnemra_rt cookie to the backend as a Cookie header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { accessToken: 'x' }))
    vi.stubGlobal('fetch', fetchMock)

    const req = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'mnemra_rt=existing-value' },
    })

    await POST(req)

    const [, options] = fetchMock.mock.calls[0]
    expect((options.headers as Record<string, string>).Cookie).toBe('mnemra_rt=existing-value')
  })

  it('sets mnemra_at cookie when refresh succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(200, { accessToken: 'new-access-token' }, {
          'set-cookie': 'mnemra_rt=new-rotated-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'mnemra_rt=old-value' },
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    const cookies = res.headers.get('set-cookie') ?? ''
    expect(cookies).toContain('mnemra_at=new-access-token')
  })

  it('passes through a non-200 status (e.g. an expired/revoked token) without a Set-Cookie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid or expired refresh token' })))

    const req = new NextRequest('http://localhost:3000/api/auth/refresh', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
