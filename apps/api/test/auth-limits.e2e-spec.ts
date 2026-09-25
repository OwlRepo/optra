import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { desc, eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap'

jest.setTimeout(120_000)

// Per-ACCOUNT limits on top of the per-address ones. Booted as production
// (configureApp, TRUST_PROXY=1), so every request presents its own visitor
// address the way the BFF forwards it - which is how these tests get past the
// per-address limits to reach the per-account ones.

const prefix = `auth-limits-${Date.now()}-`
const RESEND_ANSWER = 'If that account is waiting for verification, a new code is on its way.'
let visitor = 0
const nextAddress = () => `198.51.100.${(visitor++ % 250) + 1}`

describe('Per-account auth limits (e2e)', () => {
  let app: NestExpressApplication
  const originalTrustProxy = process.env.TRUST_PROXY

  const post = (path: string, body: object, address = nextAddress()) =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', address).send(body)

  async function registered(name: string): Promise<string> {
    const email = `${prefix}${name}@example.com`
    await post('/auth/register', { email, password: 'password123' }).expect(201)
    return email
  }

  async function newestCode(email: string): Promise<string> {
    const [row] = await db
      .select({ code: otps.code })
      .from(otps)
      .innerJoin(users, eq(users.id, otps.userId))
      .where(eq(users.email, email))
      .orderBy(desc(otps.createdAt))
      .limit(1)
    return row.code
  }

  async function codeCount(email: string): Promise<number> {
    const rows = await db
      .select({ id: otps.id })
      .from(otps)
      .innerJoin(users, eq(users.id, otps.userId))
      .where(eq(users.email, email))
    return rows.length
  }

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1'
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app)
    await app.init()
  })

  afterAll(async () => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = originalTrustProxy
    const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
    for (const u of testUsers) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, u.id))
      await db.delete(otps).where(eq(otps.userId, u.id))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, u.id))
      await db.delete(workspaces).where(eq(workspaces.ownerId, u.id))
    }
    await db.delete(users).where(like(users.email, `${prefix}%`))
    await app.close()
    await pool.end()
  })

  it('error: 20 failed sign-ins lock the account for every address, even with the right password', async () => {
    const email = await registered('locked')
    await post('/auth/verify-otp', { email, code: await newestCode(email) }).expect(201)
    for (let i = 0; i < 20; i++) await post('/auth/login', { email, password: 'wrong-password' }).expect(401)

    const locked = await post('/auth/login', { email, password: 'password123' }).expect(429)
    expect(locked.body.message).toBe('Too many sign-in attempts for this account. Try again later.')
  })

  // Sent all at once: each attempt is counted before the password is checked,
  // so requests in flight together cannot all slip under the cap.
  it('error: twenty-five sign-ins sent at once cannot beat the cap', async () => {
    const email = `${prefix}burst@example.com`
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => post('/auth/login', { email, password: 'wrong-password' })),
    )
    expect(responses.filter((res) => res.status === 429)).toHaveLength(5)
  })

  it('error: failures on an email with no account are counted the same way', async () => {
    const email = `${prefix}nobody@example.com`
    for (let i = 0; i < 20; i++) await post('/auth/login', { email, password: 'wrong-password' }).expect(401)
    await post('/auth/login', { email, password: 'wrong-password' }).expect(429)
  })

  it('error: five wrong codes burn the code, even from five different addresses', async () => {
    const email = await registered('burn')
    const code = await newestCode(email)
    const wrong = code === '111111' ? '222222' : '111111'
    for (let i = 0; i < 4; i++) {
      const res = await post('/auth/verify-otp', { email, code: wrong }).expect(401)
      expect(res.body.message).toBe('Invalid or expired code')
    }
    const burned = await post('/auth/verify-otp', { email, code: wrong }).expect(401)
    expect(burned.body.message).toBe('Too many wrong codes. Request a new code.')

    const late = await post('/auth/verify-otp', { email, code }).expect(401)
    expect(late.body.message).toBe('Invalid or expired code')
  })

  it('error: resend refuses a malformed email', async () => {
    await post('/auth/resend-otp', { email: 'not-an-email' }).expect(400)
  })

  it('edge: a correct sign-in clears the count', async () => {
    const email = await registered('clears')
    await post('/auth/verify-otp', { email, code: await newestCode(email) }).expect(201)
    for (let i = 0; i < 19; i++) await post('/auth/login', { email, password: 'wrong-password' }).expect(401)
    await post('/auth/login', { email, password: 'password123' }).expect(200)
    for (let i = 0; i < 19; i++) await post('/auth/login', { email, password: 'wrong-password' }).expect(401)
    await post('/auth/login', { email, password: 'password123' }).expect(200)
  })

  it('edge: resend answers the same for an unknown email and a verified account, and sends nothing', async () => {
    const unknown = await post('/auth/resend-otp', { email: `${prefix}ghost@example.com` }).expect(200)
    expect(unknown.body.message).toBe(RESEND_ANSWER)

    const email = await registered('verified-resend')
    await post('/auth/verify-otp', { email, code: await newestCode(email) }).expect(201)
    const before = await codeCount(email)
    const verified = await post('/auth/resend-otp', { email }).expect(200)
    expect(verified.body.message).toBe(RESEND_ANSWER)
    expect(await codeCount(email)).toBe(before)
  })

  it('edge: an email gets at most three new codes an hour', async () => {
    const email = await registered('resend-cap')
    for (let i = 0; i < 3; i++) await post('/auth/resend-otp', { email }).expect(200)
    expect(await codeCount(email)).toBe(4)

    await post('/auth/resend-otp', { email }).expect(200)
    expect(await codeCount(email)).toBe(4)
  })

  it('regression: a verified account cannot be verified again into a second workspace', async () => {
    const email = await registered('twice')
    await post('/auth/verify-otp', { email, code: await newestCode(email) }).expect(201)
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    await db.insert(otps).values({ userId: user.id, code: '123456', expiresAt: new Date(Date.now() + 600_000) })

    await post('/auth/verify-otp', { email, code: '123456' }).expect(401)

    const owned = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, user.id))
    expect(owned).toHaveLength(1)
  })

  it('happy: a new code replaces the old one and verifies', async () => {
    const email = await registered('resend')
    const first = await newestCode(email)
    const res = await post('/auth/resend-otp', { email }).expect(200)
    expect(res.body.message).toBe(RESEND_ANSWER)
    const second = await newestCode(email)

    if (second !== first) await post('/auth/verify-otp', { email, code: first }).expect(401)
    await post('/auth/verify-otp', { email, code: second }).expect(201)
  })

  it('happy: addresses in one IPv6 /64 share a sign-in bucket; another /64 does not', async () => {
    const email = `${prefix}v6@example.com`
    for (let i = 1; i <= 10; i++) {
      await post('/auth/login', { email, password: 'wrong-password' }, `2001:db8:1:2::${i.toString(16)}`).expect(401)
    }
    const shared = await post('/auth/login', { email, password: 'wrong-password' }, '2001:db8:1:2::ff').expect(429)
    expect(shared.body.message).toBe('Too many requests. Please wait a few minutes and try again.')

    await post('/auth/login', { email, password: 'wrong-password' }, '2001:db8:1:3::1').expect(401)
  })
})
