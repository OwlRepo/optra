import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return { status, json: async () => body, headers: new Headers() } as unknown as Response
}

describe('POST /api/auth/resend-otp proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: passes a 429 straight through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(429, { message: 'Too many requests.' })))

    const res = await POST(
      new NextRequest('http://localhost:3000/api/auth/resend-otp', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    )

    expect(res.status).toBe(429)
  })

  it('happy: forwards the email and the visitor address, and returns the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { message: 'on its way' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new NextRequest('http://localhost:3000/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/auth/resend-otp')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.7',
    })
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('on its way')
  })
})
