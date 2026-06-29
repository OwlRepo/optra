import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

function mockBackendResponse(ok: boolean, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response
}

describe('middleware', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('redirects to /login when mnemra_rt cookie is absent', async () => {
    const req = new NextRequest('http://localhost:3000/dashboard')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('lets through when both mnemra_rt and mnemra_at are present', async () => {
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { Cookie: 'mnemra_rt=rt-value; mnemra_at=at-value' },
    })
    const res = await middleware(req)
    // NextResponse.next() is a pass-through — no redirect
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('calls refresh when mnemra_rt exists but mnemra_at is absent, and sets both cookies on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(true, { accessToken: 'new-access-token' }, {
          'set-cookie': 'mnemra_rt=new-rt-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { Cookie: 'mnemra_rt=old-rt-value' },
    })

    const res = await middleware(req)

    expect(res.status).not.toBe(307)
    const cookies = res.headers.get('set-cookie') ?? ''
    expect(cookies).toContain('mnemra_rt=new-rt-value')
    expect(cookies).toContain('mnemra_at=new-access-token')
  })

  it('redirects to /login when refresh returns a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(false, { message: 'Invalid or expired refresh token' }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { Cookie: 'mnemra_rt=expired-rt' },
    })

    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('redirects to /login when refresh fetch throws (e.g. network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { Cookie: 'mnemra_rt=some-rt' },
    })

    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})
