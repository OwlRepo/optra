import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/auth/change-password proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword123' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
  })

  it('forwards bearer + body to the backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { message: 'Password changed. Please log in again.' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword123' }),
    })

    const response = await POST(request)

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/auth/change-password', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword123' }),
    })
    expect(response.status).toBe(200)
  })

  it('passes through backend 401 status untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Current password is incorrect' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'newpassword123' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
