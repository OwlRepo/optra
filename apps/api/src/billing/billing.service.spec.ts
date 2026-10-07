import { BadGatewayException, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { eq, like } from 'drizzle-orm'
import { db, pool, users, workspaceMembers, workspaceSubscriptions, workspaces } from '@repo/db'
import { BillingService } from './billing.service'
import { CreateCheckoutDto } from './dto/create-checkout.dto'
import { EntitlementService } from './entitlement.service'
import { LemonSqueezyClient } from './lemonsqueezy.client'

const PREFIX = `billing-svc-spec-${Date.now()}-`
const DAY = 24 * 60 * 60 * 1000

const FULL_ENV: Record<string, string | undefined> = {
  LEMONSQUEEZY_API_URL: 'http://ls.test',
  LEMONSQUEEZY_API_KEY: 'lsk-unit',
  LEMONSQUEEZY_STORE_ID: '4242',
  LEMONSQUEEZY_VARIANT_SOLO: '9001',
  LEMONSQUEEZY_VARIANT_TEAM: '9002',
  WEB_URL: 'https://optra.test',
}

function serviceWith(overrides: Record<string, string | undefined> = {}) {
  const env = { ...FULL_ENV, ...overrides }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  return new BillingService(config, new EntitlementService(config), new LemonSqueezyClient(config))
}

let counter = 0
async function seedWorkspace(trialEndsAt: Date | null = null) {
  counter += 1
  const [user] = await db
    .insert(users)
    .values({ email: `${PREFIX}${counter}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `${PREFIX}ws`, ownerId: user.id, trialEndsAt })
    .returning({ id: workspaces.id })
  return workspace.id
}

async function seedSubscription(workspaceId: string, status: string, endsAt: Date | null = null) {
  await db.insert(workspaceSubscriptions).values({
    workspaceId,
    lsSubscriptionId: `sub-${workspaceId}`,
    lsCustomerId: 'cus-1',
    lsVariantId: '9001',
    plan: 'solo',
    status,
    seats: 1,
    endsAt,
    lsUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
  })
}

async function subscriptionCount(workspaceId: string) {
  return (await db.select({ id: workspaceSubscriptions.id }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId))).length
}

const checkoutOk = () =>
  new Response(JSON.stringify({ data: { attributes: { url: 'https://store.lemonsqueezy.com/checkout/custom/abc' } } }), { status: 201 })

function lastCheckoutBody(fetchSpy: jest.SpiedFunction<typeof fetch>) {
  const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit]
  return JSON.parse(call[1].body as string)
}

describe('BillingService', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  afterAll(async () => {
    const owners = await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
    for (const owner of owners) {
      const owned = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, owner.id))
      for (const workspace of owned) {
        await db.delete(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspace.id))
        await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))
        await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
      }
    }
    await db.delete(users).where(like(users.email, `${PREFIX}%`))
    await pool.end()
  })

  it('error: checkout is 409 while a subscription is active, past_due or cancelled before ends_at', async () => {
    const cases: Array<[string, Date | null]> = [
      ['active', null],
      ['past_due', null],
      ['cancelled', new Date(Date.now() + 5 * DAY)],
    ]
    for (const [status, endsAt] of cases) {
      const id = await seedWorkspace()
      await seedSubscription(id, status, endsAt)

      await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo' })).rejects.toBeInstanceOf(ConflictException)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('error: seats 0, 26, 1.5 and a seats value with the solo plan are BadRequest', async () => {
    const id = await seedWorkspace()
    const pipe = new ValidationPipe({ whitelist: true })

    for (const seats of [0, 26, 1.5]) {
      await expect(
        pipe.transform({ plan: 'team', seats }, { type: 'body', metatype: CreateCheckoutDto }),
      ).rejects.toBeInstanceOf(BadRequestException)
    }
    await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo', seats: 2 })).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('error: a Lemon Squeezy 5xx or timeout surfaces as 502 and writes nothing', async () => {
    const id = await seedWorkspace()

    fetchSpy.mockImplementation(async () => new Response('down', { status: 500 }))
    await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo' })).rejects.toBeInstanceOf(BadGatewayException)

    fetchSpy.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'team', seats: 2 })).rejects.toBeInstanceOf(BadGatewayException)

    expect(await subscriptionCount(id)).toBe(0)
  })

  it("error: checkout with the plan's variant env unset is 503", async () => {
    const id = await seedWorkspace()

    await expect(
      serviceWith({ LEMONSQUEEZY_VARIANT_TEAM: undefined }).createCheckout(id, 'o@example.com', { plan: 'team', seats: 2 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(
      serviceWith({ LEMONSQUEEZY_VARIANT_SOLO: undefined }).createCheckout(id, 'o@example.com', { plan: 'solo' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('error: portal without a subscription row is NotFoundException', async () => {
    const id = await seedWorkspace()

    await expect(serviceWith().portalUrl(id)).rejects.toBeInstanceOf(NotFoundException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('error: portal with Lemon Squeezy unavailable is 502', async () => {
    const id = await seedWorkspace()
    await seedSubscription(id, 'active')
    fetchSpy.mockImplementation(async () => new Response('down', { status: 503 }))

    await expect(serviceWith().portalUrl(id)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('edge: an expired subscription allows a new checkout', async () => {
    const id = await seedWorkspace()
    await seedSubscription(id, 'expired')
    fetchSpy.mockImplementation(async () => checkoutOk())

    await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo' })).resolves.toEqual({
      url: 'https://store.lemonsqueezy.com/checkout/custom/abc',
    })
  })

  it('edge: team passes quantity = seats (default 1) and solo passes no quantity', async () => {
    const id = await seedWorkspace()
    fetchSpy.mockImplementation(async () => checkoutOk())

    await serviceWith().createCheckout(id, 'o@example.com', { plan: 'team', seats: 4 })
    expect(lastCheckoutBody(fetchSpy).data.attributes.checkout_data.variant_quantities).toEqual([{ variant_id: 9002, quantity: 4 }])

    await serviceWith().createCheckout(id, 'o@example.com', { plan: 'team' })
    expect(lastCheckoutBody(fetchSpy).data.attributes.checkout_data.variant_quantities).toEqual([{ variant_id: 9002, quantity: 1 }])

    await serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo' })
    const solo = lastCheckoutBody(fetchSpy)
    expect(solo.data.relationships.variant.data.id).toBe('9001')
    expect(solo.data.attributes.checkout_data).not.toHaveProperty('variant_quantities')
  })

  it("edge: the workspace id and email sent to Lemon Squeezy are the arguments, not anything from a body", async () => {
    const id = await seedWorkspace()
    fetchSpy.mockImplementation(async () => checkoutOk())

    // A hostile body field (workspace_id) is not part of the typed input; the
    // service signature has no place to carry it, and only the argument is sent.
    await serviceWith().createCheckout(id, 'owner@example.com', {
      plan: 'solo',
      workspace_id: '99999999-9999-4999-8999-999999999999',
    } as never)

    const body = lastCheckoutBody(fetchSpy)
    expect(body.data.attributes.checkout_data.custom).toEqual({ workspace_id: id })
    expect(body.data.attributes.checkout_data.email).toBe('owner@example.com')
    expect(JSON.stringify(body)).not.toContain('99999999-9999-4999-8999-999999999999')
  })

  it('edge: the redirect url is WEB_URL/workspaces/:id/billing?checkout=success', async () => {
    const id = await seedWorkspace()
    fetchSpy.mockImplementation(async () => checkoutOk())

    await serviceWith().createCheckout(id, 'o@example.com', { plan: 'solo' })

    expect(lastCheckoutBody(fetchSpy).data.attributes.product_options.redirect_url).toBe(
      `https://optra.test/workspaces/${id}/billing?checkout=success`,
    )
  })

  it('happy: createCheckout returns the hosted url', async () => {
    const id = await seedWorkspace()
    fetchSpy.mockImplementation(async () => checkoutOk())

    await expect(serviceWith().createCheckout(id, 'o@example.com', { plan: 'team', seats: 2 })).resolves.toEqual({
      url: 'https://store.lemonsqueezy.com/checkout/custom/abc',
    })
    expect(await subscriptionCount(id)).toBe(0)
  })

  it('happy: portalUrl returns the customer portal url', async () => {
    const id = await seedWorkspace()
    await seedSubscription(id, 'active')
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: 'https://p.test/portal/1' } } } }), { status: 200 }),
    )

    await expect(serviceWith().portalUrl(id)).resolves.toEqual({ url: 'https://p.test/portal/1' })
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(`http://ls.test/v1/subscriptions/sub-${id}`)
  })

  it('happy: summary returns the entitlement shape', async () => {
    const id = await seedWorkspace(new Date(Date.now() + 5 * DAY))

    const summary = await serviceWith().summary(id)

    expect(summary).toEqual(
      expect.objectContaining({ state: 'trialing', enforced: false, plan: null, used: { matchedLines: null, photoChecks: null } }),
    )
  })
})
