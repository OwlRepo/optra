import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function apiResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/webhooks/lemonsqueezy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('POST /api/webhooks/lemonsqueezy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: an oversize body is 413', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await POST(post(new Uint8Array(1024 * 1024 + 1)))

    expect(response.status).toBe(413)
  })

  it('error: a 401 from the API is returned as 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse(401, { message: 'Invalid signature' })))

    const response = await POST(post('{}', { 'x-signature': 'wrong' }))

    expect(response.status).toBe(401)
  })

  it('happy: a signed body is forwarded and the 200 is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(200, { received: true }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(post('{"meta":{}}', { 'x-signature': 'sig', 'x-event-name': 'subscription_created' }))

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/billing/webhooks/lemonsqueezy')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
  })
})
