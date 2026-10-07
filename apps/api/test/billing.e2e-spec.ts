import { createHash, createHmac, randomUUID } from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { eq, inArray, like } from 'drizzle-orm'
import request from 'supertest'
import {
  billingEvents,
  db,
  invitations,
  otps,
  pool,
  refreshTokens,
  users,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap'

jest.setTimeout(30_000)

const SECRET = 'whsec-e2e-billing'
const STORE_ID = '4242'
const VARIANT_SOLO = '9001'
const VARIANT_TEAM = '9002'
const PASSWORD = 'password123'
const DAY = 24 * 60 * 60 * 1000

const sign = (body: Buffer | string) => createHmac('sha256', SECRET).update(body).digest('hex')
const bindingSig = (workspaceId: string) => createHmac('sha256', SECRET).update(workspaceId).digest('hex')
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex')

// In-process stand-in for the Lemon Squeezy REST API. Records every checkout
// request body so a case can assert on custom.workspace_id.
interface LsStub {
  url: string
  checkouts: any[]
  mode: 'ok' | 'fail'
  close: () => Promise<void>
}

async function startLsStub(): Promise<LsStub> {
  const stub = { checkouts: [] as any[], mode: 'ok' as 'ok' | 'fail' } as LsStub
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/vnd.api+json' })
        res.end(JSON.stringify(body))
      }
      if (stub.mode === 'fail') return send(500, { errors: [{ detail: 'stub failure' }] })
      if (req.method === 'POST' && req.url === '/v1/checkouts') {
        stub.checkouts.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        const id = randomUUID()
        return send(201, { data: { attributes: { url: `${stub.url}/checkout/${id}` } } })
      }
      const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(req.url ?? '')
      if (req.method === 'GET' && subscription) {
        return send(200, { data: { attributes: { urls: { customer_portal: `${stub.url}/portal/${subscription[1]}` } } } })
      }
      send(404, { errors: [{ detail: `no stub route ${req.method} ${req.url}` }] })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  stub.close = () => new Promise((resolve) => server.close(() => resolve()))
  return stub
}

interface EventInput {
  name?: string
  workspaceId: string
  subscriptionId?: string
  status?: string
  variantId?: number
  quantity?: number
  updatedAt?: string
  storeId?: number
  endsAt?: string | null
  userName?: string
  workspaceSig?: string | null
}

function eventBody(input: EventInput): Buffer {
  return Buffer.from(
    JSON.stringify({
      meta: { event_name: input.name ?? 'subscription_created', custom_data: {
          workspace_id: input.workspaceId,
          ...(input.workspaceSig === null ? {} : { workspace_sig: input.workspaceSig ?? bindingSig(input.workspaceId) }),
        },
      },
      data: {
        type: 'subscriptions',
        id: input.subscriptionId ?? `sub-${randomUUID()}`,
        attributes: {
          store_id: input.storeId ?? Number(STORE_ID),
          customer_id: 777,
          variant_id: input.variantId ?? Number(VARIANT_TEAM),
          status: input.status ?? 'active',
          first_subscription_item: { quantity: input.quantity ?? 3 },
          renews_at: '2026-11-08T12:00:00.000000Z',
          ends_at: input.endsAt ?? null,
          updated_at: input.updatedAt ?? new Date().toISOString(),
          user_name: input.userName ?? 'E2E Buyer',
        },
      },
    }),
    'utf8',
  )
}

describe('Billing (e2e)', () => {
  let app: NestExpressApplication
  let ls: LsStub
  const prefix = `e2e-billing-${Date.now()}-`
  const seenShas: string[] = []
  const savedEnv: Record<string, string | undefined> = {}
  const ENV_KEYS = [
    'LEMONSQUEEZY_API_URL',
    'LEMONSQUEEZY_API_KEY',
    'LEMONSQUEEZY_STORE_ID',
    'LEMONSQUEEZY_WEBHOOK_SECRET',
    'LEMONSQUEEZY_VARIANT_SOLO',
    'LEMONSQUEEZY_VARIANT_TEAM',
    'BILLING_ENFORCEMENT',
  ]

  type Actor = { id: string; email: string; token: string }
  let owner: Actor
  let admin: Actor
  let member: Actor
  let outsider: Actor
  let ownerFirstWorkspaceId: string

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `${prefix}${label}@example.com`
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD }).expect(201)
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)
    const res = await request(app.getHttpServer()).post('/auth/verify-otp').send({ email, code: otp.code }).expect(201)
    return { id: user.id, email, token: res.body.accessToken as string }
  }

  // Each case gets its own workspace (POST /workspaces: no trial), with the
  // shared admin and member added by SQL so registrations stay within the
  // /auth/register throttle.
  async function freshWorkspace(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `Billing e2e ${randomUUID().slice(0, 8)}` })
      .expect(201)
    await db.insert(workspaceMembers).values([
      { workspaceId: res.body.id, userId: admin.id, role: 'admin' },
      { workspaceId: res.body.id, userId: member.id, role: 'member' },
    ])
    return res.body.id as string
  }

  const as = (actor: Actor, method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${actor.token}`)

  function postWebhook(body: Buffer | string, signature?: string) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
    seenShas.push(sha(bytes))
    const req = request(app.getHttpServer())
      .post('/billing/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Event-Name', 'subscription_created')
    if (signature !== undefined) req.set('X-Signature', signature)
    // superagent JSON-encodes a Buffer body ({"type":"Buffer",...}) when the
    // content type is JSON; a string goes out byte-for-byte, so the server
    // verifies the exact bytes that were signed.
    return req.send(bytes.toString('utf8'))
  }

  const signedWebhook = (body: Buffer) => postWebhook(body, sign(body))

  async function eventRow(body: Buffer) {
    const [row] = await db.select().from(billingEvents).where(eq(billingEvents.bodySha256, sha(body)))
    return row
  }

  async function subscriptionRow(workspaceId: string) {
    const [row] = await db.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    return row
  }

  beforeAll(async () => {
    ls = await startLsStub()
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    Object.assign(process.env, {
      LEMONSQUEEZY_API_URL: ls.url,
      LEMONSQUEEZY_API_KEY: 'lsk-e2e',
      LEMONSQUEEZY_STORE_ID: STORE_ID,
      LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
      LEMONSQUEEZY_VARIANT_SOLO: VARIANT_SOLO,
      LEMONSQUEEZY_VARIANT_TEAM: VARIANT_TEAM,
      BILLING_ENFORCEMENT: 'off',
    })

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true })
    configureApp(app)
    await app.init()

    owner = await registerAndVerify('owner')
    admin = await registerAndVerify('admin')
    member = await registerAndVerify('member')
    outsider = await registerAndVerify('outsider')
    const [first] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, owner.id))
    ownerFirstWorkspaceId = first.id
  })

  afterAll(async () => {
    if (seenShas.length) await db.delete(billingEvents).where(inArray(billingEvents.bodySha256, seenShas))
    const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
    for (const user of matches) {
      const memberships = await db
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, user.id))
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
      await db.delete(otps).where(eq(otps.userId, user.id))
      for (const { workspaceId } of memberships) {
        await db.delete(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        await db.delete(invitations).where(eq(invitations.workspaceId, workspaceId))
        await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))
        await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
      }
    }
    await db.delete(users).where(like(users.email, `${prefix}%`))
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    await app.close()
    await ls.close()
    await pool.end()
  })

  beforeEach(() => {
    ls.mode = 'ok'
    ls.checkouts.length = 0
  })

  it('error: a webhook without X-Signature is 401 and stores nothing', async () => {
    const body = eventBody({ workspaceId: ownerFirstWorkspaceId })

    await postWebhook(body).expect(401)

    expect(await eventRow(body)).toBeUndefined()
  })

  it('error: a webhook with a wrong signature is 401', async () => {
    const body = eventBody({ workspaceId: ownerFirstWorkspaceId })

    await postWebhook(body, 'f'.repeat(64)).expect(401)
    await postWebhook(body, 'short').expect(401)

    expect(await eventRow(body)).toBeUndefined()
  })

  it('error: a webhook signed over a re-serialized body is 401', async () => {
    const body = eventBody({ workspaceId: ownerFirstWorkspaceId })
    const reserialized = JSON.stringify(JSON.parse(body.toString('utf8')), null, 2)
    expect(reserialized).not.toBe(body.toString('utf8'))

    await postWebhook(body, sign(reserialized)).expect(401)

    expect(await eventRow(body)).toBeUndefined()
  })

  it('error: no token is 401 on summary, checkout and portal', async () => {
    const id = await freshWorkspace()

    await request(app.getHttpServer()).get(`/workspaces/${id}/billing`).expect(401)
    await request(app.getHttpServer()).post(`/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(401)
    await request(app.getHttpServer()).post(`/workspaces/${id}/billing/portal`).expect(401)
  })

  it('error: a member and an admin cannot checkout or open the portal (403)', async () => {
    const id = await freshWorkspace()

    for (const actor of [member, admin]) {
      await as(actor, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(403)
      await as(actor, 'post', `/workspaces/${id}/billing/portal`).expect(403)
    }
    expect(ls.checkouts).toHaveLength(0)
  })

  it("error: another workspace's id is 403 on summary, checkout and portal", async () => {
    const id = await freshWorkspace()

    await as(outsider, 'get', `/workspaces/${id}/billing`).expect(403)
    await as(outsider, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(403)
    await as(outsider, 'post', `/workspaces/${id}/billing/portal`).expect(403)
    await as(outsider, 'get', `/workspaces/not-a-uuid/billing`).expect(403)
    expect(ls.checkouts).toHaveLength(0)
  })

  it('error: checkout with an invalid plan, seats 26, or seats with solo is 400', async () => {
    const id = await freshWorkspace()
    const post = (body: unknown) => as(owner, 'post', `/workspaces/${id}/billing/checkout`).send(body as object)

    await post({ plan: 'enterprise' }).expect(400)
    await post({}).expect(400)
    await post({ plan: 'team', seats: 26 }).expect(400)
    await post({ plan: 'team', seats: 0 }).expect(400)
    await post({ plan: 'team', seats: 1.5 }).expect(400)
    await post({ plan: 'solo', seats: 2 }).expect(400)
    expect(ls.checkouts).toHaveLength(0)
  })

  it('error: checkout while subscribed is 409', async () => {
    const id = await freshWorkspace()
    await signedWebhook(eventBody({ workspaceId: id, status: 'active' })).expect(200)

    await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(409)

    expect(ls.checkouts).toHaveLength(0)
  })

  it('error: checkout when Lemon Squeezy answers 500 is 502', async () => {
    const id = await freshWorkspace()
    ls.mode = 'fail'

    await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(502)

    expect(await subscriptionRow(id)).toBeUndefined()
  })

  it('error: checkout when Lemon Squeezy is unreachable is 502', async () => {
    const id = await freshWorkspace()
    const original = process.env.LEMONSQUEEZY_API_URL
    process.env.LEMONSQUEEZY_API_URL = 'http://127.0.0.1:1'
    try {
      await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(502)
    } finally {
      process.env.LEMONSQUEEZY_API_URL = original
    }
  })

  it('error: portal without a subscription is 404', async () => {
    const id = await freshWorkspace()

    await as(owner, 'post', `/workspaces/${id}/billing/portal`).expect(404)
  })

  it('edge: a signed body of the wrong shape is 400', async () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world', nonce: randomUUID() }), 'utf8')

    await signedWebhook(body).expect(400)

    expect(await eventRow(body)).toBeUndefined()
  })

  it('edge: a signed subscription_created whose workspace_sig is missing or forged is 200, records "workspace binding" and writes no row', async () => {
    const id = await freshWorkspace()
    const missing = eventBody({ workspaceId: id, workspaceSig: null })
    const forged = eventBody({ workspaceId: id, workspaceSig: 'a'.repeat(64) })

    await signedWebhook(missing).expect(200)
    await signedWebhook(forged).expect(200)

    expect((await eventRow(missing)).lastError).toMatch(/workspace binding/)
    expect((await eventRow(forged)).lastError).toMatch(/workspace binding/)
    expect(await subscriptionRow(id)).toBeUndefined()
  })

  it('edge: an unknown variant or unset store id is 500 with processed_at null, and a resend after the env is fixed succeeds', async () => {
    const id = await freshWorkspace()
    const body = eventBody({ workspaceId: id, variantId: Number(VARIANT_TEAM) })
    const original = process.env.LEMONSQUEEZY_STORE_ID
    process.env.LEMONSQUEEZY_STORE_ID = ''
    try {
      await signedWebhook(body).expect(500)
    } finally {
      process.env.LEMONSQUEEZY_STORE_ID = original
    }
    const failed = await eventRow(body)
    expect(failed.lastError).toBeTruthy()
    expect(failed.processedAt).toBeNull()

    await signedWebhook(body).expect(200)

    expect((await eventRow(body)).processedAt).not.toBeNull()
    expect((await subscriptionRow(id)).status).toBe('active')
  })

  it.each([0, -1, 1.5, 26])('edge: a signed team event with quantity %p is 200 "invalid quantity" and writes no row', async (quantity) => {
    const id = await freshWorkspace()
    const body = eventBody({ workspaceId: id, variantId: Number(VARIANT_TEAM), quantity })

    await signedWebhook(body).expect(200)

    expect((await eventRow(body)).lastError).toMatch(/invalid quantity/)
    expect(await subscriptionRow(id)).toBeUndefined()
  })

  it('edge: two concurrent signed first deliveries for one workspace leave one row', async () => {
    const id = await freshWorkspace()
    const updatedAt = new Date().toISOString()
    const a = eventBody({ workspaceId: id, updatedAt })
    const b = eventBody({ workspaceId: id, updatedAt })

    await Promise.all([signedWebhook(a).expect(200), signedWebhook(b).expect(200)])

    const rows = await db.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, id))
    expect(rows).toHaveLength(1)
    const errors = [(await eventRow(a)).lastError, (await eventRow(b)).lastError]
    expect(errors.filter((e) => e && /already has an active subscription/.test(e))).toHaveLength(1)
  })

  it('edge: a signed event for a wrong store is 200 and records last_error', async () => {
    const id = await freshWorkspace()
    const body = eventBody({ workspaceId: id, storeId: 31337 })

    const res = await signedWebhook(body).expect(200)

    expect(res.body).toEqual({ received: true })
    expect((await eventRow(body)).lastError).toMatch(/store_id/)
    expect(await subscriptionRow(id)).toBeUndefined()
  })

  it("edge: a fresh signup's summary is trialing with trialEndsAt about 14 days out", async () => {
    const res = await as(owner, 'get', `/workspaces/${ownerFirstWorkspaceId}/billing`).expect(200)

    expect(res.body.state).toBe('trialing')
    expect(res.body.enforced).toBe(false)
    expect(res.body.plan).toBeNull()
    const ends = new Date(res.body.trialEndsAt).getTime()
    expect(Math.abs(ends - (Date.now() + 14 * DAY))).toBeLessThan(5 * 60 * 1000)
    expect(res.body.used).toEqual({ matchedLines: null, photoChecks: null })
  })

  it('edge: a plain member can read the summary', async () => {
    const id = await freshWorkspace()

    const res = await as(member, 'get', `/workspaces/${id}/billing`).expect(200)

    expect(res.body.state).toBe('none')
    expect(res.body.quotas).toBeNull()
  })

  it('edge: BILLING_ENFORCEMENT=on makes the summary report enforced true and still refuses nothing', async () => {
    const id = await freshWorkspace()
    process.env.BILLING_ENFORCEMENT = 'on'
    try {
      const res = await as(owner, 'get', `/workspaces/${id}/billing`).expect(200)
      expect(res.body.enforced).toBe(true)
      expect(res.body.state).toBe('none')
      await as(owner, 'get', `/workspaces/${id}`).expect(200)
      await as(owner, 'get', '/workspaces/me').expect(200)
      await as(member, 'get', `/workspaces/${id}/members`).expect(200)
    } finally {
      process.env.BILLING_ENFORCEMENT = 'off'
    }
  })

  it('regression: GET /workspaces/:id has no trialEndsAt or billingExempt key', async () => {
    const res = await as(owner, 'get', `/workspaces/${ownerFirstWorkspaceId}`).expect(200)

    expect(res.body).not.toHaveProperty('trialEndsAt')
    expect(res.body).not.toHaveProperty('billingExempt')
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id', 'name', 'ownerId', 'role'])
  })

  it('regression: a signed subscription_created containing a non-ASCII name is accepted through the raw-body path', async () => {
    const id = await freshWorkspace()
    const body = eventBody({ workspaceId: id, userName: 'José Müller 王 \u{1F680}' })

    await signedWebhook(body).expect(200)

    expect((await subscriptionRow(id)).status).toBe('active')
    expect(((await eventRow(body)).payload as any).data.attributes.user_name).toBe('José Müller 王 \u{1F680}')
  })

  it('happy: checkout returns the stub url and the stub received custom.workspace_id equal to the route id, the caller email and the redirect url', async () => {
    const id = await freshWorkspace()

    const res = await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(201)

    expect(res.body.url).toMatch(new RegExp(`^${ls.url}/checkout/`))
    expect(ls.checkouts).toHaveLength(1)
    const attributes = ls.checkouts[0].data.attributes
    expect(attributes.checkout_data.custom).toEqual({ workspace_id: id, workspace_sig: bindingSig(id) })
    expect(attributes.checkout_data.email).toBe(owner.email)
    expect(attributes.product_options.redirect_url).toBe(
      `${process.env.WEB_URL || 'http://localhost:3000'}/workspaces/${id}/billing?checkout=success`,
    )
  })

  it('happy: team checkout with seats 3 sends variant_quantities with quantity 3 and solo sends none', async () => {
    const id = await freshWorkspace()

    await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'team', seats: 3 }).expect(201)
    await as(owner, 'post', `/workspaces/${id}/billing/checkout`).send({ plan: 'solo' }).expect(201)

    expect(ls.checkouts[0].data.attributes.checkout_data.variant_quantities).toEqual([
      { variant_id: Number(VARIANT_TEAM), quantity: 3 },
    ])
    expect(ls.checkouts[1].data.attributes.checkout_data).not.toHaveProperty('variant_quantities')
    expect(ls.checkouts[1].data.relationships.variant.data.id).toBe(VARIANT_SOLO)
  })

  it('happy: a signed subscription_created writes the row and the summary becomes subscribed with plan team and seats 3', async () => {
    const id = await freshWorkspace()
    const body = eventBody({ workspaceId: id, variantId: Number(VARIANT_TEAM), quantity: 3 })

    const res = await signedWebhook(body).expect(200)
    expect(res.body).toEqual({ received: true })

    const row = await subscriptionRow(id)
    expect(row.plan).toBe('team')
    expect(row.seats).toBe(3)
    const summary = await as(owner, 'get', `/workspaces/${id}/billing`).expect(200)
    expect(summary.body).toMatchObject({ state: 'subscribed', plan: 'team', seats: 3, subscriptionStatus: 'active' })
    expect(summary.body.quotas).toEqual({ matchedLines: 6000, photoChecks: 900 })
  })

  it('happy: portal returns the stub portal url once subscribed', async () => {
    const id = await freshWorkspace()
    const subscriptionId = `sub-${randomUUID()}`
    await signedWebhook(eventBody({ workspaceId: id, subscriptionId })).expect(200)

    const res = await as(owner, 'post', `/workspaces/${id}/billing/portal`).expect(200)

    expect(res.body.url).toBe(`${ls.url}/portal/${subscriptionId}`)
  })

  it('happy: cancelled keeps the workspace subscribed until ends_at and expired ends it', async () => {
    const id = await freshWorkspace()
    const subscriptionId = `sub-${randomUUID()}`
    const now = Date.now()
    await signedWebhook(eventBody({ workspaceId: id, subscriptionId, updatedAt: new Date(now - 3000).toISOString() })).expect(200)

    await signedWebhook(
      eventBody({
        name: 'subscription_cancelled',
        workspaceId: id,
        subscriptionId,
        status: 'cancelled',
        endsAt: new Date(now + 5 * DAY).toISOString(),
        updatedAt: new Date(now - 2000).toISOString(),
      }),
    ).expect(200)
    const cancelled = await as(owner, 'get', `/workspaces/${id}/billing`).expect(200)
    expect(cancelled.body).toMatchObject({ state: 'subscribed', subscriptionStatus: 'cancelled' })

    await signedWebhook(
      eventBody({
        name: 'subscription_expired',
        workspaceId: id,
        subscriptionId,
        status: 'expired',
        updatedAt: new Date(now - 1000).toISOString(),
      }),
    ).expect(200)
    const expired = await as(owner, 'get', `/workspaces/${id}/billing`).expect(200)
    expect(expired.body).toMatchObject({ state: 'none', subscriptionStatus: 'expired' })
  })
})
