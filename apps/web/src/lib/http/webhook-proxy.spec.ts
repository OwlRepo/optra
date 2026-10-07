import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { forwardRaw, WEBHOOK_MAX_BYTES } from './webhook-proxy'

function apiResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

function webhookRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/webhooks/lemonsqueezy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

function sentBytes(fetchMock: ReturnType<typeof vi.fn>): Buffer {
  const init = fetchMock.mock.calls[0][1] as { body: Uint8Array }
  return Buffer.from(init.body)
}

describe('forwardRaw', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: a body over 1 MB is 413 and the API is never called', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await forwardRaw(webhookRequest(new Uint8Array(WEBHOOK_MAX_BYTES + 1)), '/billing/webhooks/lemonsqueezy')

    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: a declared content-length over the cap is 413 without reading the body', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = webhookRequest('{}', { 'content-length': String(WEBHOOK_MAX_BYTES + 1) })

    const response = await forwardRaw(request, '/billing/webhooks/lemonsqueezy')

    expect(response.status).toBe(413)
    expect(request.bodyUsed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: an unreachable API is 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const response = await forwardRaw(webhookRequest('{}'), '/billing/webhooks/lemonsqueezy')

    expect(response.status).toBe(502)
  })

  it.each([
    ['TimeoutError', 'The operation timed out.'],
    ['AbortError', 'This operation was aborted'],
  ])('error: an aborted fetch (%s) is 504 Gateway Timeout, not 502', async (name, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException(message, name)))

    const response = await forwardRaw(webhookRequest('{}'), '/billing/webhooks/lemonsqueezy')

    expect(response.status).toBe(504)
  })

  it('edge: the API fetch carries an AbortSignal so a hung API cannot hold the webhook open', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(200, { received: true }))
    vi.stubGlobal('fetch', fetchMock)

    await forwardRaw(webhookRequest('{}'), '/billing/webhooks/lemonsqueezy')

    const signal = fetchMock.mock.calls[0][1].signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('edge: a missing X-Signature is forwarded as absent (the API answers 401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(401, { message: 'Invalid signature' }))
    vi.stubGlobal('fetch', fetchMock)

    await forwardRaw(webhookRequest('{}', { 'x-event-name': 'subscription_created' }), '/billing/webhooks/lemonsqueezy')

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('x-signature')
  })

  it('edge: no Authorization header and no cookies are forwarded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(200, { received: true }))
    vi.stubGlobal('fetch', fetchMock)

    await forwardRaw(
      webhookRequest('{}', { authorization: 'Bearer stolen', cookie: 'mnemra_at=abc; mnemra_rt=def', 'x-signature': 'sig' }),
      '/billing/webhooks/lemonsqueezy',
    )

    const headers = Object.keys(fetchMock.mock.calls[0][1].headers as Record<string, string>).map((name) => name.toLowerCase())
    expect(headers).not.toContain('authorization')
    expect(headers).not.toContain('cookie')
  })

  it.each([
    ['non-ASCII', '{"meta":{"event_name":"subscription_created"},"data":{"attributes":{"user_name":"José Müller 王"}}}'],
    ['odd whitespace', '{ "a" :\n\t1 ,   "b":  [ 1 ,2 ]  }\n\n'],
    ['reordered keys and escapes', '{"z":1,"a":"\\u00e9\\/","m":{"y":2,"b":1}}'],
  ])('regression: the forwarded bytes equal the received bytes for %s', async (_label, text) => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(200, { received: true }))
    vi.stubGlobal('fetch', fetchMock)
    const received = Buffer.from(text, 'utf8')

    await forwardRaw(webhookRequest(new Uint8Array(received)), '/billing/webhooks/lemonsqueezy')

    expect(sentBytes(fetchMock).equals(received)).toBe(true)
  })

  it('regression: the API\'s status and body come back unchanged (a 401 stays a 401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse(401, { message: 'Invalid signature', statusCode: 401 })))

    const response = await forwardRaw(webhookRequest('{}', { 'x-signature': 'bad' }), '/billing/webhooks/lemonsqueezy')

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Invalid signature', statusCode: 401 })
  })

  it('happy: POSTs to API_URL/billing/webhooks/lemonsqueezy with X-Signature, X-Event-Name and the content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(200, { received: true }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await forwardRaw(
      webhookRequest('{"ok":true}', { 'x-signature': 'abc123', 'x-event-name': 'subscription_created' }),
      '/billing/webhooks/lemonsqueezy',
    )

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/billing/webhooks/lemonsqueezy')
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'x-signature': 'abc123',
      'x-event-name': 'subscription_created',
      'Content-Type': 'application/json',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
  })
})
