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

describe('POST /api/auth/register proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the backend message and status straight through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockBackendResponse(201, { message: 'Check your email for the verification code' })),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.message).toMatch(/check your email/i)
  })

  it('passes through a 409 on a duplicate email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBackendResponse(409, { message: 'Email already registered' })))

    const req = new NextRequest('http://localhost:3000/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
  })
})
