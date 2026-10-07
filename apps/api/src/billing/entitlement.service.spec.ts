import { NotFoundException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { eq, like } from 'drizzle-orm'
import { db, pool, users, workspaceMembers, workspaceSubscriptions, workspaces } from '@repo/db'
import { EntitlementService } from './entitlement.service'
import { TRIAL_DAYS } from './plans'

const PREFIX = `entitlement-spec-${Date.now()}-`
const NOW = new Date('2026-10-08T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

let env: Record<string, string | undefined> = {}
const config = { get: (key: string) => env[key] } as unknown as ConfigService
const service = new EntitlementService(config)

let counter = 0
async function seedWorkspace(opts: { trialEndsAt?: Date | null; exempt?: boolean } = {}) {
  counter += 1
  const [user] = await db
    .insert(users)
    .values({ email: `${PREFIX}${counter}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: `${PREFIX}ws`,
      ownerId: user.id,
      trialEndsAt: opts.trialEndsAt ?? null,
      billingExempt: opts.exempt ?? false,
    })
    .returning({ id: workspaces.id })
  return workspace.id
}

async function seedSubscription(
  workspaceId: string,
  opts: { status: string; plan?: 'solo' | 'team'; seats?: number; endsAt?: Date | null; renewsAt?: Date | null },
) {
  await db.insert(workspaceSubscriptions).values({
    workspaceId,
    lsSubscriptionId: `sub-${workspaceId}`,
    lsCustomerId: 'cus-1',
    lsVariantId: opts.plan === 'team' ? '9002' : '9001',
    plan: opts.plan ?? 'solo',
    status: opts.status,
    seats: opts.seats ?? 1,
    renewsAt: opts.renewsAt ?? null,
    endsAt: opts.endsAt ?? null,
    lsUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
  })
}

async function cleanup() {
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
}

describe('EntitlementService', () => {
  beforeEach(() => {
    env = {}
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it('error: an unknown workspace throws NotFoundException', async () => {
    await expect(service.resolve('00000000-0000-4000-8000-000000000000', NOW)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('error: no trial and no subscription is none with null quotas', async () => {
    const id = await seedWorkspace()

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('none')
    expect(summary.quotas).toBeNull()
    expect(summary.period).toBeNull()
    expect(summary.plan).toBeNull()
    expect(summary.subscriptionStatus).toBeNull()
  })

  it('error: an expired trial is none', async () => {
    const id = await seedWorkspace({ trialEndsAt: new Date(NOW.getTime() - DAY) })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('none')
    expect(summary.quotas).toBeNull()
    expect(summary.trialEndsAt).toBe(new Date(NOW.getTime() - DAY).toISOString())
  })

  it('error: an expired, unpaid or paused subscription is none', async () => {
    for (const status of ['expired', 'unpaid', 'paused']) {
      const id = await seedWorkspace()
      await seedSubscription(id, { status })

      const summary = await service.resolve(id, NOW)

      expect(summary.state).toBe('none')
      expect(summary.subscriptionStatus).toBe(status)
    }
  })

  it('error: a cancelled subscription at or past ends_at is none', async () => {
    const atEnd = await seedWorkspace()
    await seedSubscription(atEnd, { status: 'cancelled', endsAt: NOW })
    const pastEnd = await seedWorkspace()
    await seedSubscription(pastEnd, { status: 'cancelled', endsAt: new Date(NOW.getTime() - DAY) })

    expect((await service.resolve(atEnd, NOW)).state).toBe('none')
    expect((await service.resolve(pastEnd, NOW)).state).toBe('none')
  })

  it('edge: a cancelled subscription before ends_at is subscribed', async () => {
    const id = await seedWorkspace()
    const endsAt = new Date(NOW.getTime() + 5 * DAY)
    await seedSubscription(id, { status: 'cancelled', endsAt })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('subscribed')
    expect(summary.subscriptionStatus).toBe('cancelled')
    expect(summary.endsAt).toBe(endsAt.toISOString())
  })

  it('edge: past_due is subscribed', async () => {
    const id = await seedWorkspace()
    await seedSubscription(id, { status: 'past_due' })

    expect((await service.resolve(id, NOW)).state).toBe('subscribed')
  })

  it('edge: an ended subscription during an open trial falls back to trialing', async () => {
    const id = await seedWorkspace({ trialEndsAt: new Date(NOW.getTime() + 3 * DAY) })
    await seedSubscription(id, { status: 'expired' })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('trialing')
    expect(summary.subscriptionStatus).toBe('expired')
  })

  it('edge: exempt beats trial, subscription and none, with unlimited quotas', async () => {
    const bare = await seedWorkspace({ exempt: true })
    const withTrial = await seedWorkspace({ exempt: true, trialEndsAt: new Date(NOW.getTime() + DAY) })
    const withSub = await seedWorkspace({ exempt: true })
    await seedSubscription(withSub, { status: 'active', plan: 'team', seats: 4 })

    for (const id of [bare, withTrial, withSub]) {
      const summary = await service.resolve(id, NOW)
      expect(summary.state).toBe('exempt')
      expect(summary.quotas).toEqual({ matchedLines: null, photoChecks: null })
      expect(summary.period).toBeNull()
    }
    const subSummary = await service.resolve(withSub, NOW)
    expect(subSummary.plan).toBe('team')
    expect(subSummary.seats).toBe(4)
    expect((await service.resolve(bare, NOW)).plan).toBeNull()
  })

  it('edge: team seats multiply the quotas and solo ignores seats', async () => {
    const team = await seedWorkspace()
    await seedSubscription(team, { status: 'active', plan: 'team', seats: 3 })
    const solo = await seedWorkspace()
    await seedSubscription(solo, { status: 'active', plan: 'solo', seats: 5 })

    expect((await service.resolve(team, NOW)).quotas).toEqual({ matchedLines: 6000, photoChecks: 900 })
    expect((await service.resolve(solo, NOW)).quotas).toEqual({ matchedLines: 400, photoChecks: 100 })
  })

  it('edge: trialing uses the Solo quotas and a period of trial start to trial end', async () => {
    const trialEndsAt = new Date(NOW.getTime() + 6 * DAY)
    const id = await seedWorkspace({ trialEndsAt })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('trialing')
    expect(summary.plan).toBeNull()
    expect(summary.quotas).toEqual({ matchedLines: 400, photoChecks: 100 })
    expect(summary.period).toEqual({
      start: new Date(trialEndsAt.getTime() - TRIAL_DAYS * DAY).toISOString(),
      end: trialEndsAt.toISOString(),
    })
  })

  it('edge: a paid period is the UTC calendar month and rolls over December to January', async () => {
    const id = await seedWorkspace()
    await seedSubscription(id, { status: 'active' })

    expect((await service.resolve(id, new Date('2026-10-31T23:59:59.999Z'))).period).toEqual({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    })
    expect((await service.resolve(id, new Date('2026-12-15T10:00:00.000Z'))).period).toEqual({
      start: '2026-12-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
    })
  })

  it("edge: another workspace's subscription never counts", async () => {
    const mine = await seedWorkspace()
    const theirs = await seedWorkspace()
    await seedSubscription(theirs, { status: 'active', plan: 'team', seats: 9 })

    const summary = await service.resolve(mine, NOW)

    expect(summary.state).toBe('none')
    expect(summary.plan).toBeNull()
    expect(summary.seats).toBeNull()
  })

  it('regression: enforced mirrors BILLING_ENFORCEMENT, is false by default and only the exact value on turns it on, and never changes the state', async () => {
    const id = await seedWorkspace()

    env = {}
    const off = await service.resolve(id, NOW)
    expect(off.enforced).toBe(false)

    for (const value of ['off', 'ON', 'true', '1', ' on', '']) {
      env = { BILLING_ENFORCEMENT: value }
      expect((await service.resolve(id, NOW)).enforced).toBe(false)
    }

    env = { BILLING_ENFORCEMENT: 'on' }
    const on = await service.resolve(id, NOW)
    expect(on.enforced).toBe(true)
    expect(on.state).toBe(off.state)
  })

  it('regression: used is null for both counters until the ledger exists', async () => {
    const id = await seedWorkspace({ trialEndsAt: new Date(NOW.getTime() + DAY) })
    const paid = await seedWorkspace()
    await seedSubscription(paid, { status: 'active' })

    expect((await service.resolve(id, NOW)).used).toEqual({ matchedLines: null, photoChecks: null })
    expect((await service.resolve(paid, NOW)).used).toEqual({ matchedLines: null, photoChecks: null })
  })

  it('happy: an active solo subscription is subscribed with plan solo and seats 1', async () => {
    const id = await seedWorkspace()
    const renewsAt = new Date(NOW.getTime() + 20 * DAY)
    await seedSubscription(id, { status: 'active', plan: 'solo', renewsAt })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('subscribed')
    expect(summary.plan).toBe('solo')
    expect(summary.seats).toBe(1)
    expect(summary.subscriptionStatus).toBe('active')
    expect(summary.renewsAt).toBe(renewsAt.toISOString())
  })

  it('happy: a future trial_ends_at is trialing', async () => {
    const trialEndsAt = new Date(NOW.getTime() + 10 * DAY)
    const id = await seedWorkspace({ trialEndsAt })

    const summary = await service.resolve(id, NOW)

    expect(summary.state).toBe('trialing')
    expect(summary.trialEndsAt).toBe(trialEndsAt.toISOString())
  })
})
