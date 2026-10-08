import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { RefineEmptyError, RefineRefusalError, refineMessage } from '@repo/ai'
import {
  db,
  otps,
  pool,
  refreshTokens,
  savedRefinedMessages,
  usageEvents,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'

jest.mock('@repo/ai', () => ({
  refineMessage: jest.fn(),
  RefineEmptyError: class RefineEmptyError extends Error {},
  RefineRefusalError: class RefineRefusalError extends Error {},
  // UsageService.metered() constructs a real meter; a minimal stand-in priced
  // like gpt-4o ($2.50 / $10 per 1M tokens) so the e2e can assert ledger rows.
  TokenMeter: class {
    private input = 0
    private output = 0
    private model: string | null = null
    record(response: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } | null, model?: string): void {
      const usage = response?.usage_metadata
      if (!usage) return
      this.input += usage.input_tokens ?? 0
      this.output += usage.output_tokens ?? 0
      if (model) this.model = model
    }
    get total(): number {
      return this.input + this.output
    }
    get inputTokens(): number {
      return this.input
    }
    get outputTokens(): number {
      return this.output
    }
    get costMicroUsd(): number {
      return Math.ceil(this.input * 2.5 + this.output * 10)
    }
    get dominantModel(): string | null {
      return this.model
    }
  },
}))

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(savedRefinedMessages).where(eq(savedRefinedMessages.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(savedRefinedMessages).where(eq(savedRefinedMessages.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function registerAndVerify(app: INestApplication, email: string, password: string) {
  await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201)

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

  const verifyRes = await request(app.getHttpServer())
    .post('/auth/verify-otp')
    .send({ email, code: otp.code })
    .expect(201)

  return {
    user,
    accessToken: verifyRes.body.accessToken as string,
  }
}

describe('Refine flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-refine-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('refines a message, forbids non-members, validates input, maps chain errors, saves and lists scoped to caller', async () => {
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body.items[0].id as string

    ;(refineMessage as jest.Mock).mockResolvedValue('Clean refined question')

    const refineRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'raw messy question' })
      .expect(201)

    expect(refineRes.body).toEqual({ original: 'raw messy question', refined: 'Clean refined question' })

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ text: 'raw messy question' })
      .expect(403)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: '' })
      .expect(400)

    ;(refineMessage as jest.Mock).mockRejectedValueOnce(new RefineEmptyError())
    const emptyRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'produces empty output' })
      .expect(422)
    expect(emptyRes.body.message).toMatch(/try rephrasing/i)

    ;(refineMessage as jest.Mock).mockRejectedValueOnce(new RefineRefusalError())
    const refusalRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'triggers a refusal' })
      .expect(422)
    expect(refusalRes.body.message).toMatch(/try rephrasing/i)

    const statusRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/status`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(statusRes.body.used).toBeGreaterThanOrEqual(1)
    expect(statusRes.body.limit).toBeGreaterThan(0)
    expect(statusRes.body.remaining).toBe(statusRes.body.limit - statusRes.body.used)

    const saveRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ originalText: 'raw messy question', refinedText: 'Clean refined question' })
      .expect(201)
    expect(saveRes.body.id).toBeDefined()
    expect(saveRes.body.originalText).toBe('raw messy question')
    expect(saveRes.body.refinedText).toBe('Clean refined question')

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(listRes.body.items).toHaveLength(1)
    expect(listRes.body.items[0].refinedText).toBe('Clean refined question')

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/refine/saved`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)
  })

  it('returns 429 after exceeding the daily refine limit', async () => {
    const member = await registerAndVerify(app, `${prefix}ratelimit@example.com`, password)

    const mine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const workspaceId = mine.body.items[0].id as string

    ;(refineMessage as jest.Mock).mockResolvedValue('ok')

    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/refine`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ text: `Refine me ${i}` })
        .expect(201)
    }

    const blocked = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/refine`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ text: 'Refine me final' })
      .expect(429)

    expect(blocked.body.message).toBe('Daily refine limit reached')
  })

  describe('billing metering (S4)', () => {
    // Registration is capped at 5 per 10 minutes; seed the owner directly.
    async function seedOwnerWithWorkspace(email: string) {
      const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
      const [workspace] = await db.insert(workspaces).values({ name: 'S4 Refine', ownerId: user.id }).returning()
      await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
      return { workspaceId: workspace.id, accessToken: app.get(JwtService).sign({ sub: user.id, email }) }
    }

    async function withEnforcement<T>(value: string, fn: () => Promise<T>): Promise<T> {
      const previous = process.env.BILLING_ENFORCEMENT
      process.env.BILLING_ENFORCEMENT = value
      try {
        return await fn()
      } finally {
        if (previous === undefined) delete process.env.BILLING_ENFORCEMENT
        else process.env.BILLING_ENFORCEMENT = previous
      }
    }

    const refine = (owner: { workspaceId: string; accessToken: string }) =>
      request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/refine`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ text: 'raw messy question' })

    it('error: state none gets 402 SUBSCRIPTION_REQUIRED on refine', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-none@example.com`)
      ;(refineMessage as jest.Mock).mockResolvedValue('Should not be reached')

      const res = await withEnforcement('on', () => refine(owner).expect(402))

      expect(res.body).toMatchObject({ statusCode: 402, code: 'SUBSCRIPTION_REQUIRED' })
      expect(refineMessage).not.toHaveBeenCalled()
    })

    it('happy: refine writes an llm_cost row with enforcement off', async () => {
      const owner = await seedOwnerWithWorkspace(`${prefix}s4-off@example.com`)
      ;(refineMessage as jest.Mock).mockImplementation(
        async (_text: string, options: { meter: { record: (r: unknown, m?: string) => void } }) => {
          options.meter.record({ usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }, 'gpt-4o')
          return 'Clean refined question'
        },
      )

      const res = await withEnforcement('off', () => refine(owner).expect(201))

      expect(res.body).toEqual({ original: 'raw messy question', refined: 'Clean refined question' })
      const rows = await db.select().from(usageEvents).where(eq(usageEvents.workspaceId, owner.workspaceId))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'llm_cost', quantity: 7500, model: 'gpt-4o' })
    })
  })
})
