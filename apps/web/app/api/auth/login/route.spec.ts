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

describe('POST /api/auth/login proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the Set-Cookie header from the backend back to the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(200, { accessToken: 'fake-token' }, {
          'set-cookie': 'mnemra_rt=session-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('mnemra_rt=session-value')
  })

  it('sets mnemra_at cookie when login succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockBackendResponse(200, { accessToken: 'jwt.token.value' }, {
          'set-cookie': 'mnemra_rt=session-value; HttpOnly; Path=/',
        }),
      ),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    const cookies = res.headers.get('set-cookie') ?? ''
    expect(cookies).toContain('mnemra_at=jwt.token.value')
  })

  it('does not set mnemra_at when login fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid credentials' })))

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'wrong' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('passes through a 401 without a Set-Cookie on bad credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid credentials' })))

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'wrong' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
