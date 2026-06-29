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

describe('POST /api/auth/verify-otp proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the Set-Cookie header from the backend back to the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(201, { accessToken: 'fake-token' }, {
          'set-cookie': 'mnemra_rt=first-session-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', code: '123456' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toContain('mnemra_rt=first-session-value')
  })

  it('sets mnemra_at cookie when OTP verification succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(201, { accessToken: 'jwt.token.value' }, {
          'set-cookie': 'mnemra_rt=first-session-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', code: '123456' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    const cookies = res.headers.get('set-cookie') ?? ''
    expect(cookies).toContain('mnemra_at=jwt.token.value')
  })

  it('passes through a 401 without a Set-Cookie on a wrong code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid or expired code' })))

    const req = new NextRequest('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', code: '000000' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
