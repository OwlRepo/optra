import { BadRequestException, InternalServerErrorException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { createHash, createHmac, randomUUID } from 'crypto'
import { eq, inArray, like } from 'drizzle-orm'
import { billingEvents, db, pool, users, workspaceSubscriptions, workspaces } from '@repo/db'
import { BillingWebhookService } from './billing-webhook.service'
import { EntitlementService } from './entitlement.service'

const PREFIX = `billing-webhook-spec-${Date.now()}-`
const SECRET = 'whsec-unit-test'
const STORE_ID = '4242'

const FULL_ENV: Record<string, string | undefined> = {
  LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
  LEMONSQUEEZY_STORE_ID: STORE_ID,
  LEMONSQUEEZY_VARIANT_SOLO: '9001',
  LEMONSQUEEZY_VARIANT_TEAM: '9002',
}

function configWith(overrides: Record<string, string | undefined> = {}) {
  const env = { ...FULL_ENV, ...overrides }
  return { get: (key: string) => env[key] } as unknown as ConfigService
}

const service = new BillingWebhookService(configWith())

const sign = (body: Buffer) => createHmac('sha256', SECRET).update(body).digest('hex')
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex')

interface EventInput {
  name?: string
  workspaceId?: string | null
  customWorkspaceId?: unknown
  subscriptionId?: string
  status?: string
  variantId?: number | string
  quantity?: number
  updatedAt?: string
  storeId?: number | string
  renewsAt?: string | null
  endsAt?: string | null
  userName?: string
  customerId?: number
}

function eventBody(input: EventInput): Buffer {
  const custom =
    'customWorkspaceId' in input
      ? { workspace_id: input.customWorkspaceId }
      : input.workspaceId === null
        ? {}
        : { workspace_id: input.workspaceId }
  const body = {
    meta: { event_name: input.name ?? 'subscription_created', custom_data: custom },
    data: {
      type: 'subscriptions',
      id: input.subscriptionId ?? 'sub-1',
      attributes: {
        store_id: input.storeId ?? Number(STORE_ID),
        customer_id: input.customerId ?? 777,
        variant_id: input.variantId ?? 9002,
        status: input.status ?? 'active',
        first_subscription_item: { quantity: input.quantity ?? 3 },
        renews_at: input.renewsAt === undefined ? '2026-11-08T12:00:00.000000Z' : input.renewsAt,
        ends_at: input.endsAt ?? null,
        updated_at: input.updatedAt ?? '2026-10-08T12:00:00.000000Z',
        user_name: input.userName ?? 'Test Buyer',
      },
    },
  }
  return Buffer.from(JSON.stringify(body), 'utf8')
}

const seenShas: string[] = []
function deliver(body: Buffer, opts: { svc?: BillingWebhookService; signature?: string } = {}) {
  seenShas.push(sha(body))
  return (opts.svc ?? service).handle(body, opts.signature ?? sign(body))
}

let counter = 0
async function seedWorkspace() {
  counter += 1
  const [user] = await db
    .insert(users)
    .values({ email: `${PREFIX}${counter}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db.insert(workspaces).values({ name: `${PREFIX}ws`, ownerId: user.id }).returning({ id: workspaces.id })
  return workspace.id
}

const uniqueSub = () => `sub-${randomUUID()}`

async function subscriptionOf(workspaceId: string) {
  const [row] = await db.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId))
  return row
}

async function eventFor(body: Buffer) {
  const [row] = await db.select().from(billingEvents).where(eq(billingEvents.bodySha256, sha(body)))
  return row
}

async function eventsStored(body: Buffer) {
  return (await db.select({ id: billingEvents.id }).from(billingEvents).where(eq(billingEvents.bodySha256, sha(body)))).length
}

describe('BillingWebhookService', () => {
  afterAll(async () => {
    if (seenShas.length) await db.delete(billingEvents).where(inArray(billingEvents.bodySha256, seenShas))
    const owners = await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
    for (const owner of owners) {
      const owned = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, owner.id))
      for (const workspace of owned) {
        await db.delete(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspace.id))
        await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
      }
    }
    await db.delete(users).where(like(users.email, `${PREFIX}%`))
    await pool.end()
  })

  it('error: a missing or wrong signature is Unauthorized and stores nothing', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub() })

    await expect(service.handle(body, undefined)).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(service.handle(body, 'deadbeef')).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(service.handle(body, sign(Buffer.from('other')))).rejects.toBeInstanceOf(UnauthorizedException)

    expect(await eventsStored(body)).toBe(0)
    expect(await subscriptionOf(workspaceId)).toBeUndefined()
  })

  it('error: an unset secret is ServiceUnavailable and stores nothing', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub() })
    const unconfigured = new BillingWebhookService(configWith({ LEMONSQUEEZY_WEBHOOK_SECRET: undefined }))

    await expect(unconfigured.handle(body, sign(body))).rejects.toBeInstanceOf(ServiceUnavailableException)

    expect(await eventsStored(body)).toBe(0)
  })

  it('error: a signed body that is not JSON is BadRequest', async () => {
    const body = Buffer.from(`not json ${randomUUID()}`, 'utf8')

    await expect(deliver(body)).rejects.toBeInstanceOf(BadRequestException)

    expect(await eventsStored(body)).toBe(0)
  })

  it('error: a signed body without meta.event_name is BadRequest', async () => {
    const body = Buffer.from(JSON.stringify({ meta: {}, data: { id: randomUUID(), attributes: {} } }), 'utf8')

    await expect(deliver(body)).rejects.toBeInstanceOf(BadRequestException)

    expect(await eventsStored(body)).toBe(0)
  })

  it('error: a wrong store_id is acknowledged, recorded with last_error, and writes no subscription', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), storeId: 999 })

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const event = await eventFor(body)
    expect(event.lastError).toMatch(/store_id/)
    expect(event.processedAt).not.toBeNull()
    expect(await subscriptionOf(workspaceId)).toBeUndefined()
  })

  it('error: an unknown variant is acknowledged with last_error and writes no subscription', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), variantId: 123456 })

    await expect(deliver(body)).resolves.toEqual({ received: true })

    expect((await eventFor(body)).lastError).toMatch(/unknown variant/)
    expect(await subscriptionOf(workspaceId)).toBeUndefined()
  })

  it('error: a non-UUID or missing custom_data.workspace_id is acknowledged with last_error', async () => {
    const missing = eventBody({ workspaceId: null, subscriptionId: uniqueSub() })
    const notUuid = eventBody({ customWorkspaceId: 'not-a-uuid', subscriptionId: uniqueSub() })

    await expect(deliver(missing)).resolves.toEqual({ received: true })
    await expect(deliver(notUuid)).resolves.toEqual({ received: true })

    expect((await eventFor(missing)).lastError).toMatch(/missing workspace_id/)
    expect((await eventFor(notUuid)).lastError).toMatch(/missing workspace_id/)
  })

  it('error: an unknown workspace id is acknowledged with last_error', async () => {
    const body = eventBody({ workspaceId: randomUUID(), subscriptionId: uniqueSub() })

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const event = await eventFor(body)
    expect(event.lastError).toMatch(/unknown workspace/)
    expect(event.processedAt).not.toBeNull()
  })

  it('error: a subscription id already stored for another workspace is refused and the other row is untouched', async () => {
    const owner = await seedWorkspace()
    const intruder = await seedWorkspace()
    const subscriptionId = uniqueSub()
    await deliver(eventBody({ workspaceId: owner, subscriptionId, quantity: 2, updatedAt: '2026-10-08T10:00:00.000000Z' }))
    const before = await subscriptionOf(owner)

    const stolen = eventBody({ workspaceId: intruder, subscriptionId, quantity: 9, updatedAt: '2026-10-08T11:00:00.000000Z' })
    await expect(deliver(stolen)).resolves.toEqual({ received: true })

    expect((await eventFor(stolen)).lastError).toMatch(/another workspace/)
    expect(await subscriptionOf(intruder)).toBeUndefined()
    const after = await subscriptionOf(owner)
    expect(after.seats).toBe(before.seats)
    expect(after.lsUpdatedAt.getTime()).toBe(before.lsUpdatedAt.getTime())
  })

  it('error: a database failure during the upsert throws 500, stores last_error and leaves processed_at null', async () => {
    const workspaceId = await seedWorkspace()
    // 99999999999 overflows the integer seats column, so the upsert itself fails.
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), quantity: 99_999_999_999 })

    await expect(deliver(body)).rejects.toBeInstanceOf(InternalServerErrorException)

    const event = await eventFor(body)
    expect(event.lastError).toBeTruthy()
    expect(event.processedAt).toBeNull()
    expect(await subscriptionOf(workspaceId)).toBeUndefined()
  })

  it('edge: a duplicate delivery of a processed body does not touch the row again', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), status: 'active' })
    await deliver(body)
    await db.update(workspaceSubscriptions).set({ status: 'paused' }).where(eq(workspaceSubscriptions.workspaceId, workspaceId))

    await expect(deliver(body)).resolves.toEqual({ received: true })

    expect((await subscriptionOf(workspaceId)).status).toBe('paused')
    expect(await eventsStored(body)).toBe(1)
  })

  it('edge: a delivery whose earlier attempt failed is processed on retry', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub() })
    await db.insert(billingEvents).values({
      eventName: 'subscription_created',
      bodySha256: sha(body),
      payload: JSON.parse(body.toString('utf8')),
      lastError: 'boom from the previous attempt',
    })
    seenShas.push(sha(body))

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const event = await eventFor(body)
    expect(event.processedAt).not.toBeNull()
    expect(event.lastError).toBeNull()
    expect(await eventsStored(body)).toBe(1)
    expect((await subscriptionOf(workspaceId)).status).toBe('active')
  })

  it('edge: an older updated_at is skipped and the newer row stays', async () => {
    const workspaceId = await seedWorkspace()
    const subscriptionId = uniqueSub()
    await deliver(eventBody({ workspaceId, subscriptionId, status: 'active', updatedAt: '2026-10-08T12:00:00.000000Z' }))

    const stale = eventBody({ workspaceId, subscriptionId, status: 'paused', updatedAt: '2026-10-08T11:00:00.000000Z' })
    await expect(deliver(stale)).resolves.toEqual({ received: true })

    const row = await subscriptionOf(workspaceId)
    expect(row.status).toBe('active')
    expect(row.lsUpdatedAt.toISOString()).toBe('2026-10-08T12:00:00.000Z')
    expect((await eventFor(stale)).processedAt).not.toBeNull()
  })

  it.each(['subscription_payment_success', 'subscription_payment_failed', 'subscription_payment_recovered'])(
    'edge: %s is stored and processed with no subscription change',
    async (name) => {
      const workspaceId = await seedWorkspace()
      await deliver(eventBody({ workspaceId, subscriptionId: uniqueSub(), status: 'active' }))
      const before = await subscriptionOf(workspaceId)
      // An invoice object: its data.id is an invoice id, not a subscription id.
      const invoice = Buffer.from(
        JSON.stringify({
          meta: { event_name: name, custom_data: { workspace_id: workspaceId } },
          data: { type: 'subscription-invoices', id: `inv-${randomUUID()}`, attributes: { store_id: 4242, subscription_id: 1, status: 'paid' } },
        }),
        'utf8',
      )

      await expect(deliver(invoice)).resolves.toEqual({ received: true })

      const event = await eventFor(invoice)
      expect(event.eventName).toBe(name)
      expect(event.processedAt).not.toBeNull()
      expect(event.lastError).toBeNull()
      const after = await subscriptionOf(workspaceId)
      expect(after.lsSubscriptionId).toBe(before.lsSubscriptionId)
      expect(after.status).toBe(before.status)
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    },
  )

  it('edge: an unrelated event (order_created) is stored and ignored', async () => {
    const workspaceId = await seedWorkspace()
    const body = Buffer.from(
      JSON.stringify({
        meta: { event_name: 'order_created', custom_data: { workspace_id: workspaceId } },
        data: { type: 'orders', id: randomUUID(), attributes: { store_id: 4242 } },
      }),
      'utf8',
    )

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const event = await eventFor(body)
    expect(event.eventName).toBe('order_created')
    expect(event.processedAt).not.toBeNull()
    expect(await subscriptionOf(workspaceId)).toBeUndefined()
  })

  it('edge: a new subscription replaces an expired one for the same workspace', async () => {
    const workspaceId = await seedWorkspace()
    const first = uniqueSub()
    const second = uniqueSub()
    await deliver(eventBody({ workspaceId, subscriptionId: first, status: 'expired', updatedAt: '2026-09-01T00:00:00.000000Z' }))

    await deliver(eventBody({ workspaceId, subscriptionId: second, status: 'active', updatedAt: '2026-10-01T00:00:00.000000Z' }))

    const row = await subscriptionOf(workspaceId)
    expect(row.lsSubscriptionId).toBe(second)
    expect(row.status).toBe('active')
    expect(
      (await db.select({ id: workspaceSubscriptions.id }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId))).length,
    ).toBe(1)
  })

  it('edge: a different subscription is refused while the stored one is active', async () => {
    const workspaceId = await seedWorkspace()
    const first = uniqueSub()
    await deliver(eventBody({ workspaceId, subscriptionId: first, status: 'active' }))

    const second = eventBody({ workspaceId, subscriptionId: uniqueSub(), status: 'active', updatedAt: '2026-10-09T00:00:00.000000Z' })
    await expect(deliver(second)).resolves.toEqual({ received: true })

    expect((await eventFor(second)).lastError).toMatch(/already has an active subscription/)
    expect((await subscriptionOf(workspaceId)).lsSubscriptionId).toBe(first)
  })

  it('regression: created, then updated to past_due, then cancelled with ends_at, then expired ends as expired and resolves to none', async () => {
    const workspaceId = await seedWorkspace()
    const subscriptionId = uniqueSub()
    const endsAt = '2026-10-20T00:00:00.000000Z'

    await deliver(eventBody({ workspaceId, subscriptionId, status: 'active', updatedAt: '2026-10-01T00:00:00.000000Z' }))
    await deliver(eventBody({ name: 'subscription_updated', workspaceId, subscriptionId, status: 'past_due', updatedAt: '2026-10-02T00:00:00.000000Z' }))
    expect((await subscriptionOf(workspaceId)).status).toBe('past_due')
    await deliver(eventBody({ name: 'subscription_cancelled', workspaceId, subscriptionId, status: 'cancelled', endsAt, updatedAt: '2026-10-03T00:00:00.000000Z' }))
    const cancelled = await subscriptionOf(workspaceId)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.endsAt?.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    await deliver(eventBody({ name: 'subscription_expired', workspaceId, subscriptionId, status: 'expired', endsAt, updatedAt: '2026-10-21T00:00:00.000000Z' }))

    expect((await subscriptionOf(workspaceId)).status).toBe('expired')
    const entitlement = new EntitlementService(configWith())
    expect((await entitlement.resolve(workspaceId, new Date('2026-10-22T00:00:00.000Z'))).state).toBe('none')
  })

  it('regression: expired delivered before cancelled ends as expired', async () => {
    const workspaceId = await seedWorkspace()
    const subscriptionId = uniqueSub()
    await deliver(eventBody({ workspaceId, subscriptionId, status: 'active', updatedAt: '2026-10-01T00:00:00.000000Z' }))

    await deliver(eventBody({ name: 'subscription_expired', workspaceId, subscriptionId, status: 'expired', updatedAt: '2026-10-21T00:00:00.000000Z' }))
    await deliver(eventBody({ name: 'subscription_cancelled', workspaceId, subscriptionId, status: 'cancelled', endsAt: '2026-10-20T00:00:00.000000Z', updatedAt: '2026-10-03T00:00:00.000000Z' }))

    expect((await subscriptionOf(workspaceId)).status).toBe('expired')
  })

  it('regression: a body with non-ASCII characters verifies and stores', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), userName: 'José Müller 王 \u{1F680}' })

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const event = await eventFor(body)
    expect((event.payload as any).data.attributes.user_name).toBe('José Müller 王 \u{1F680}')
    expect(event.processedAt).not.toBeNull()
    expect(await subscriptionOf(workspaceId)).toBeDefined()
  })

  it('happy: subscription_created for team with quantity 3 stores plan team, seats 3, renews_at and sets processed_at', async () => {
    const workspaceId = await seedWorkspace()
    const subscriptionId = uniqueSub()
    const body = eventBody({ workspaceId, subscriptionId, variantId: 9002, quantity: 3, customerId: 555 })

    await expect(deliver(body)).resolves.toEqual({ received: true })

    const row = await subscriptionOf(workspaceId)
    expect(row.plan).toBe('team')
    expect(row.seats).toBe(3)
    expect(row.lsSubscriptionId).toBe(subscriptionId)
    expect(row.lsCustomerId).toBe('555')
    expect(row.lsVariantId).toBe('9002')
    expect(row.status).toBe('active')
    expect(row.renewsAt?.toISOString()).toBe('2026-11-08T12:00:00.000Z')
    const event = await eventFor(body)
    expect(event.processedAt).not.toBeNull()
    expect(event.lastError).toBeNull()
  })

  it('happy: subscription_created for solo stores seats 1', async () => {
    const workspaceId = await seedWorkspace()
    const body = eventBody({ workspaceId, subscriptionId: uniqueSub(), variantId: 9001, quantity: 5 })

    await deliver(body)

    const row = await subscriptionOf(workspaceId)
    expect(row.plan).toBe('solo')
    expect(row.seats).toBe(1)
  })
})
