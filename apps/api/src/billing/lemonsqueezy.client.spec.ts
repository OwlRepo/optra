import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { LemonSqueezyClient } from './lemonsqueezy.client'

const BASE_ENV: Record<string, string | undefined> = {
  LEMONSQUEEZY_API_URL: 'http://ls.test',
  LEMONSQUEEZY_API_KEY: 'lsk-unit',
  LEMONSQUEEZY_STORE_ID: '4242',
}

function clientWith(overrides: Record<string, string | undefined> = {}) {
  const env = { ...BASE_ENV, ...overrides }
  return new LemonSqueezyClient({ get: (key: string) => env[key] } as unknown as ConfigService)
}

const CHECKOUT_INPUT = {
  variantId: '9002',
  quantity: 3,
  email: 'buyer@example.com',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  redirectUrl: 'http://localhost:3000/workspaces/w/billing?checkout=success',
}

const checkoutOk = () =>
  new Response(JSON.stringify({ data: { attributes: { url: 'https://store.lemonsqueezy.com/checkout/custom/abc' } } }), {
    status: 201,
  })

describe('LemonSqueezyClient', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('error: a 5xx answer becomes BadGatewayException', async () => {
    fetchSpy.mockImplementation(async () => new Response('upstream down', { status: 503 }))

    await expect(clientWith().createCheckout(CHECKOUT_INPUT)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(clientWith().getSubscription('55')).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('error: a network failure becomes BadGatewayException', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))

    await expect(clientWith().createCheckout(CHECKOUT_INPUT)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(clientWith().getSubscription('55')).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('error: a timeout (TimeoutError) becomes BadGatewayException', async () => {
    fetchSpy.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(clientWith().createCheckout(CHECKOUT_INPUT)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(clientWith().getSubscription('55')).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('error: a 422 answer becomes BadGatewayException and its body is not in the message', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ errors: [{ detail: 'SECRET-LS-DETAIL variant 9002 is draft' }] }), { status: 422 }),
    )

    const error = await clientWith().createCheckout(CHECKOUT_INPUT).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BadGatewayException)
    expect(JSON.stringify((error as BadGatewayException).getResponse())).not.toContain('SECRET-LS-DETAIL')
    expect((error as BadGatewayException).message).not.toContain('SECRET-LS-DETAIL')
  })

  it.each([
    ['API key', { LEMONSQUEEZY_API_KEY: undefined }],
    ['store id', { LEMONSQUEEZY_STORE_ID: undefined }],
  ])('error: a missing %s throws ServiceUnavailableException before any fetch', async (_label, override) => {
    const client = clientWith(override)

    await expect(client.createCheckout(CHECKOUT_INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(client.getSubscription('55')).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('edge: every call carries an AbortSignal', async () => {
    fetchSpy.mockImplementation(async (input) =>
      String(input).includes('/v1/checkouts')
        ? checkoutOk()
        : new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: 'https://p.test/x' } } } }), { status: 200 }),
    )

    await clientWith().createCheckout(CHECKOUT_INPUT)
    await clientWith().getSubscription('55')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    for (const call of fetchSpy.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('edge: an answer without data.attributes.url becomes BadGatewayException', async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ data: { attributes: {} } }), { status: 201 }))
    await expect(clientWith().createCheckout(CHECKOUT_INPUT)).rejects.toBeInstanceOf(BadGatewayException)

    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify({ data: { attributes: { urls: {} } } }), { status: 200 }),
    )
    await expect(clientWith().getSubscription('55')).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('regression: the checkout body carries custom.workspace_id, string store and variant ids, and variant_quantities only when a quantity is given', async () => {
    fetchSpy.mockImplementation(async () => checkoutOk())

    await clientWith().createCheckout(CHECKOUT_INPUT)
    await clientWith().createCheckout({ ...CHECKOUT_INPUT, quantity: undefined })

    const withQuantity = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const withoutQuantity = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)

    expect(withQuantity.data.type).toBe('checkouts')
    expect(withQuantity.data.attributes.checkout_data.custom).toEqual({ workspace_id: CHECKOUT_INPUT.workspaceId })
    expect(withQuantity.data.attributes.checkout_data.email).toBe('buyer@example.com')
    expect(withQuantity.data.attributes.product_options.redirect_url).toBe(CHECKOUT_INPUT.redirectUrl)
    expect(withQuantity.data.relationships.store.data).toEqual({ type: 'stores', id: '4242' })
    expect(withQuantity.data.relationships.variant.data).toEqual({ type: 'variants', id: '9002' })
    expect(withQuantity.data.attributes.checkout_data.variant_quantities).toEqual([{ variant_id: 9002, quantity: 3 }])
    expect(withoutQuantity.data.attributes.checkout_data).not.toHaveProperty('variant_quantities')
  })

  it('happy: createCheckout posts to LEMONSQUEEZY_API_URL/v1/checkouts with the Bearer and JSON:API headers and returns the url', async () => {
    fetchSpy.mockImplementation(async () => checkoutOk())

    await expect(clientWith().createCheckout(CHECKOUT_INPUT)).resolves.toEqual({
      url: 'https://store.lemonsqueezy.com/checkout/custom/abc',
    })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://ls.test/v1/checkouts')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: 'Bearer lsk-unit',
    })
  })

  it('happy: getSubscription returns urls.customer_portal', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: 'https://p.test/portal/55' } } } }), {
          status: 200,
        }),
    )

    await expect(clientWith().getSubscription('55')).resolves.toEqual({ customerPortalUrl: 'https://p.test/portal/55' })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://ls.test/v1/subscriptions/55')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer lsk-unit' })
  })
})
