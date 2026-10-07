import { HttpException, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { eq, like } from 'drizzle-orm'
import { db, pool, usageEvents, users, workspaceMembers, workspaceSubscriptions, workspaces } from '@repo/db'
import { isBudgetExceeded } from '../limits/usage.service'
import { BillingGateService } from './billing-gate.service'
import { EntitlementService } from './entitlement.service'
import { TRIAL_DAYS } from './plans'
import { UsageLedgerService } from './usage-ledger.service'

const PREFIX = `billing-gate-spec-${Date.now()}-`
const NOW = new Date('2026-10-08T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

let env: Record<string, string | undefined> = {}
const config = { get: (key: string) => env[key] } as unknown as ConfigService
const ledger = new UsageLedgerService()
const entitlement = new EntitlementService(config, ledger)
const gate = new BillingGateService(config, entitlement, ledger)

type Kind = 'matched_line' | 'photo_check' | 'llm_cost'
type State = 'none' | 'trial' | 'solo' | 'exempt'

let counter = 0
async function seedWorkspace(state: State) {
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
      trialEndsAt: state === 'trial' ? new Date(NOW.getTime() + 5 * DAY) : state === 'none' ? new Date(NOW.getTime() - DAY) : null,
      billingExempt: state === 'exempt',
    })
    .returning({ id: workspaces.id })
  if (state === 'solo') {
    await db.insert(workspaceSubscriptions).values({
      workspaceId: workspace.id,
      lsSubscriptionId: `sub-${workspace.id}`,
      lsCustomerId: 'cus-1',
      lsVariantId: '9001',
      plan: 'solo',
      status: 'active',
      seats: 1,
      lsUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
    })
  }
  return workspace.id
}

async function seedRow(workspaceId: string, kind: Kind, quantity: number, occurredAt: Date = NOW, key?: string) {
  await db.insert(usageEvents).values({
    workspaceId,
    kind,
    quantity,
    idempotencyKey: key ?? `seed:${Math.random().toString(36).slice(2)}`,
    occurredAt,
  })
}

async function rowsOf(workspaceId: string, kind?: Kind) {
  const rows = await db.select().from(usageEvents).where(eq(usageEvents.workspaceId, workspaceId))
  return kind ? rows.filter((row) => row.kind === kind) : rows
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

async function expectStop(promise: Promise<unknown>, code: string, quota?: string) {
  const error = await caught(promise)
  expect(error).toBeInstanceOf(HttpException)
  const http = error as HttpException
  expect(http.getStatus()).toBe(402)
  const body = http.getResponse() as Record<string, unknown>
  expect(body.code).toBe(code)
  expect(body.quota).toBe(quota)
  return body
}

async function cleanup() {
  const owners = await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
  for (const owner of owners) {
    const owned = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, owner.id))
    for (const workspace of owned) {
      await db.delete(usageEvents).where(eq(usageEvents.workspaceId, workspace.id))
      await db.delete(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspace.id))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))
      await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
    }
  }
  await db.delete(users).where(like(users.email, `${PREFIX}%`))
}

describe('BillingGateService', () => {
  beforeEach(() => {
    env = { BILLING_ENFORCEMENT: 'on' }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it('error: enforcement on and state none is 402 SUBSCRIPTION_REQUIRED for matched lines, photo checks and the AI budget', async () => {
    const ws = await seedWorkspace('none')

    await expectStop(gate.assertMatchedLines(ws, 'po-1', 'inv-1', 3, NOW), 'SUBSCRIPTION_REQUIRED')
    await expectStop(gate.assertPhotoCheck(ws, NOW), 'SUBSCRIPTION_REQUIRED')
    await expectStop(gate.assertAiBudget(ws, NOW), 'SUBSCRIPTION_REQUIRED')
    expect(await rowsOf(ws)).toHaveLength(0)
  })

  it('error: a new pair over the matched-line quota is 402 QUOTA_EXCEEDED with quota matchedLines', async () => {
    const ws = await seedWorkspace('trial')
    await seedRow(ws, 'matched_line', 399)

    await expectStop(gate.assertMatchedLines(ws, 'po-over', 'inv-over', 2, NOW), 'QUOTA_EXCEEDED', 'matchedLines')
    expect(await rowsOf(ws, 'matched_line')).toHaveLength(1)
  })

  it('error: a photo check over quota is 402 QUOTA_EXCEEDED with quota photoChecks', async () => {
    const ws = await seedWorkspace('trial')
    await seedRow(ws, 'photo_check', 100)

    await expectStop(gate.assertPhotoCheck(ws, NOW), 'QUOTA_EXCEEDED', 'photoChecks')
    expect(await rowsOf(ws, 'photo_check')).toHaveLength(1)
  })

  it('error: AI cost at or over the cap is 402 AI_BUDGET_EXCEEDED', async () => {
    const atCap = await seedWorkspace('trial')
    await seedRow(atCap, 'llm_cost', 4_000_000)
    const overCap = await seedWorkspace('solo')
    await seedRow(overCap, 'llm_cost', 6_500_000)

    await expectStop(gate.assertAiBudget(atCap, NOW), 'AI_BUDGET_EXCEEDED')
    await expectStop(gate.assertAiBudget(overCap, NOW), 'AI_BUDGET_EXCEEDED')
  })

  it('error: a photo check is refused with AI_BUDGET_EXCEEDED before it consumes a photo check', async () => {
    const ws = await seedWorkspace('trial')
    await seedRow(ws, 'llm_cost', 4_000_000)

    await expectStop(gate.assertPhotoCheck(ws, NOW), 'AI_BUDGET_EXCEEDED')
    expect(await rowsOf(ws, 'photo_check')).toHaveLength(0)
  })

  it('error: a database failure in the budget read propagates and never allows the call', async () => {
    const ws = await seedWorkspace('trial')
    jest.spyOn(ledger, 'sumsByKind').mockRejectedValue(new Error('db down'))

    const error = await caught(gate.assertAiBudget(ws, NOW))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('db down')
    expect(isBudgetExceeded(error)).toBe(false)
  })

  it('error: enforcement on and a ledger reserve failure rejects for matched lines and photo checks (fail closed)', async () => {
    const ws = await seedWorkspace('trial')
    jest.spyOn(db, 'transaction').mockRejectedValue(new Error('tx down'))

    await expect(gate.assertMatchedLines(ws, 'po-f', 'inv-f', 2, NOW)).rejects.toThrow('tx down')
    await expect(gate.assertPhotoCheck(ws, NOW)).rejects.toThrow('tx down')
  })

  it('error: a re-parse whose extra lines exceed the remaining quota is 402 QUOTA_EXCEEDED and charges nothing more', async () => {
    const ws = await seedWorkspace('trial')
    await gate.assertMatchedLines(ws, 'po-x', 'inv-x', 2, NOW)
    await seedRow(ws, 'matched_line', 396)

    // 398 used of 400; 5 lines now means a delta of 3 -> 401 > 400.
    await expectStop(gate.assertMatchedLines(ws, 'po-x', 'inv-x', 5, NOW), 'QUOTA_EXCEEDED', 'matchedLines')

    const total = (await rowsOf(ws, 'matched_line')).reduce((sum, row) => sum + row.quantity, 0)
    expect(total).toBe(398)
  })

  it('edge: enforcement off records matched lines and photo checks and refuses nothing, even for none and over quota', async () => {
    env = {}
    const none = await seedWorkspace('none')
    const over = await seedWorkspace('trial')
    await seedRow(over, 'matched_line', 399)
    await seedRow(over, 'photo_check', 100)

    await expect(gate.assertMatchedLines(none, 'po-n', 'inv-n', 5, NOW)).resolves.toBeUndefined()
    await expect(gate.assertPhotoCheck(none, NOW)).resolves.toBeUndefined()
    await expect(gate.assertMatchedLines(over, 'po-o', 'inv-o', 50, NOW)).resolves.toBeUndefined()
    await expect(gate.assertPhotoCheck(over, NOW)).resolves.toBeUndefined()

    expect((await rowsOf(none, 'matched_line')).map((r) => r.quantity)).toEqual([5])
    expect(await rowsOf(none, 'photo_check')).toHaveLength(1)
    expect(await rowsOf(over, 'matched_line')).toHaveLength(2)
    expect(await rowsOf(over, 'photo_check')).toHaveLength(2)
  })

  it('edge: enforcement off assertAiBudget never reads the ledger', async () => {
    env = {}
    const ws = await seedWorkspace('none')
    const sums = jest.spyOn(ledger, 'sumsByKind')

    await expect(gate.assertAiBudget(ws, NOW)).resolves.toBeUndefined()

    expect(sums).not.toHaveBeenCalled()
  })

  it('edge: a pair already counted is allowed even when the workspace is now over quota', async () => {
    const ws = await seedWorkspace('trial')
    await gate.assertMatchedLines(ws, 'po-c', 'inv-c', 10, NOW)
    await seedRow(ws, 'matched_line', 500)

    await expect(gate.assertMatchedLines(ws, 'po-c', 'inv-c', 10, NOW)).resolves.toBeUndefined()

    expect(await rowsOf(ws, 'matched_line')).toHaveLength(2)
  })

  it('edge: a pair already counted is still refused for state none', async () => {
    const ws = await seedWorkspace('none')
    await seedRow(ws, 'matched_line', 10, NOW, 'cmp:po-d:inv-d')

    await expectStop(gate.assertMatchedLines(ws, 'po-d', 'inv-d', 10, NOW), 'SUBSCRIPTION_REQUIRED')
  })

  it('edge: exempt has no line or photo limit and a 25 USD AI guard over the calendar month', async () => {
    const ws = await seedWorkspace('exempt')
    await seedRow(ws, 'matched_line', 1_000_000)
    await seedRow(ws, 'photo_check', 1_000_000)
    // Last month's spend does not count toward this month's guard.
    await seedRow(ws, 'llm_cost', 99_000_000, new Date('2026-09-20T00:00:00.000Z'))
    await seedRow(ws, 'llm_cost', 24_999_999)

    await expect(gate.assertMatchedLines(ws, 'po-e', 'inv-e', 5000, NOW)).resolves.toBeUndefined()
    await expect(gate.assertPhotoCheck(ws, NOW)).resolves.toBeUndefined()
    await expect(gate.assertAiBudget(ws, NOW)).resolves.toBeUndefined()

    await seedRow(ws, 'llm_cost', 1)
    await expectStop(gate.assertAiBudget(ws, NOW), 'AI_BUDGET_EXCEEDED')
  })

  it('edge: trialing sums AI cost over the trial window and subscribed over the calendar month', async () => {
    // A row 13 days before trial end is inside the trial window but in September.
    const outsideMonth = new Date(NOW.getTime() + 5 * DAY - (TRIAL_DAYS - 1) * DAY)
    expect(outsideMonth.getUTCMonth()).toBe(8)

    const trial = await seedWorkspace('trial')
    await seedRow(trial, 'llm_cost', 4_000_000, outsideMonth)
    const solo = await seedWorkspace('solo')
    await seedRow(solo, 'llm_cost', 6_000_000, outsideMonth)

    await expectStop(gate.assertAiBudget(trial, NOW), 'AI_BUDGET_EXCEEDED')
    await expect(gate.assertAiBudget(solo, NOW)).resolves.toBeUndefined()

    await seedRow(solo, 'llm_cost', 6_000_000, new Date('2026-10-02T00:00:00.000Z'))
    await expectStop(gate.assertAiBudget(solo, NOW), 'AI_BUDGET_EXCEEDED')
  })

  it('edge: every refusal body has statusCode 402, a message, a code and quota only with QUOTA_EXCEEDED', async () => {
    const none = await seedWorkspace('none')
    const lines = await seedWorkspace('trial')
    await seedRow(lines, 'matched_line', 400)
    const photos = await seedWorkspace('trial')
    await seedRow(photos, 'photo_check', 100)
    const ai = await seedWorkspace('trial')
    await seedRow(ai, 'llm_cost', 4_000_000)

    const bodies = [
      await expectStop(gate.assertAiBudget(none, NOW), 'SUBSCRIPTION_REQUIRED'),
      await expectStop(gate.assertMatchedLines(lines, 'p', 'i', 1, NOW), 'QUOTA_EXCEEDED', 'matchedLines'),
      await expectStop(gate.assertPhotoCheck(photos, NOW), 'QUOTA_EXCEEDED', 'photoChecks'),
      await expectStop(gate.assertAiBudget(ai, NOW), 'AI_BUDGET_EXCEEDED'),
    ]

    for (const body of bodies) {
      expect(body.statusCode).toBe(402)
      expect(typeof body.message).toBe('string')
      expect((body.message as string).length).toBeGreaterThan(0)
      expect(Object.keys(body).sort()).toEqual(body.code === 'QUOTA_EXCEEDED' ? ['code', 'message', 'quota', 'statusCode'] : ['code', 'message', 'statusCode'])
    }
    expect(new Set(bodies.map((body) => body.message)).size).toBe(4)
  })

  it('edge: enforcement off swallows a ledger reserve failure with one warning and the call resolves', async () => {
    env = {}
    const ws = await seedWorkspace('trial')
    jest.spyOn(db, 'transaction').mockRejectedValue(new Error('tx down'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(gate.assertMatchedLines(ws, 'po-w', 'inv-w', 2, NOW)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    await expect(gate.assertPhotoCheck(ws, NOW)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[0][0])).toContain('tx down')
  })

  it('edge: the matched-line key is cmp:{po}:{invoice}:{period start date}; a trial uses its window start, a subscription the UTC month', async () => {
    const trial = await seedWorkspace('trial')
    const solo = await seedWorkspace('solo')
    const exempt = await seedWorkspace('exempt')

    await gate.assertMatchedLines(trial, 'po-k1', 'inv-k1', 1, NOW)
    await gate.assertMatchedLines(solo, 'po-k2', 'inv-k2', 1, NOW)
    await gate.assertMatchedLines(exempt, 'po-k3', 'inv-k3', 1, NOW)

    // Trial ends NOW + 5 days and lasts 14 days, so its window starts 2026-09-29.
    expect((await rowsOf(trial, 'matched_line'))[0].idempotencyKey).toBe('cmp:po-k1:inv-k1:2026-09-29')
    expect((await rowsOf(solo, 'matched_line'))[0].idempotencyKey).toBe('cmp:po-k2:inv-k2:2026-10-01')
    expect((await rowsOf(exempt, 'matched_line'))[0].idempotencyKey).toBe('cmp:po-k3:inv-k3:2026-10-01')
  })

  it('edge: the same pair, same period, same line count adds no row; enforcement off uses the UTC month key', async () => {
    const ws = await seedWorkspace('trial')
    await gate.assertMatchedLines(ws, 'po-s', 'inv-s', 4, NOW)
    await gate.assertMatchedLines(ws, 'po-s', 'inv-s', 4, NOW)
    await gate.assertMatchedLines(ws, 'po-s', 'inv-s', 3, NOW)
    expect((await rowsOf(ws, 'matched_line')).map((row) => row.quantity)).toEqual([4])

    env = {}
    const off = await seedWorkspace('none')
    await gate.assertMatchedLines(off, 'po-s', 'inv-s', 2, NOW)
    expect((await rowsOf(off, 'matched_line'))[0].idempotencyKey).toBe('cmp:po-s:inv-s:2026-10-01')
  })

  it('edge: a re-parsed pair with more lines in the same period charges only the extra lines', async () => {
    const ws = await seedWorkspace('trial')

    await gate.assertMatchedLines(ws, 'po-r', 'inv-r', 10, NOW)
    await gate.assertMatchedLines(ws, 'po-r', 'inv-r', 14, NOW)
    await gate.assertMatchedLines(ws, 'po-r', 'inv-r', 14, NOW)

    const rows = await rowsOf(ws, 'matched_line')
    expect(rows.map((row) => row.quantity).sort((a, b) => a - b)).toEqual([4, 10])
    expect(rows.find((row) => row.quantity === 10)?.idempotencyKey).toBe('cmp:po-r:inv-r:2026-09-29')
    expect(rows.every((row) => row.idempotencyKey.startsWith('cmp:po-r:inv-r:2026-09-29'))).toBe(true)
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2)
  })

  it('edge: the same pair in a new period is charged again in full', async () => {
    const ws = await seedWorkspace('solo')
    const nextMonth = new Date('2026-11-08T12:00:00.000Z')

    await gate.assertMatchedLines(ws, 'po-n2', 'inv-n2', 10, NOW)
    await gate.assertMatchedLines(ws, 'po-n2', 'inv-n2', 10, nextMonth)

    const rows = await rowsOf(ws, 'matched_line')
    expect(rows.map((row) => row.quantity)).toEqual([10, 10])
    expect(rows.map((row) => row.idempotencyKey).sort()).toEqual(['cmp:po-n2:inv-n2:2026-10-01', 'cmp:po-n2:inv-n2:2026-11-01'])
  })

  it('regression: the refusal is an HttpException with status 402, so isBudgetExceeded is true', async () => {
    const ws = await seedWorkspace('none')

    const error = await caught(gate.assertAiBudget(ws, NOW))

    expect(error).toBeInstanceOf(HttpException)
    expect(isBudgetExceeded(error)).toBe(true)
  })

  it('regression: only the exact value on enforces', async () => {
    const ws = await seedWorkspace('none')

    for (const value of ['off', 'ON', 'true', '1', ' on', '', undefined]) {
      env = { BILLING_ENFORCEMENT: value }
      await expect(gate.assertAiBudget(ws, NOW)).resolves.toBeUndefined()
    }

    env = { BILLING_ENFORCEMENT: 'on' }
    await expectStop(gate.assertAiBudget(ws, NOW), 'SUBSCRIPTION_REQUIRED')
  })

  it('regression: recordLlmCost swallows a ledger failure and logs it', async () => {
    const ws = await seedWorkspace('trial')
    jest.spyOn(ledger, 'recordLlmCost').mockRejectedValue(new Error('insert failed'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const meter = { total: 1500, costMicroUsd: 7500, inputTokens: 1000, outputTokens: 500, dominantModel: 'gpt-4o' }

    await expect(gate.recordLlmCost(ws, meter as never)).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain(ws)
    expect(message).toContain('7500')
    expect(message).toContain('insert failed')
  })

  it('happy: a new pair within quota is charged once with quantity poLineCount and key cmp:{po}:{invoice}:{period start}', async () => {
    const ws = await seedWorkspace('trial')

    await gate.assertMatchedLines(ws, 'po-9', 'inv-9', 12, NOW)
    await gate.assertMatchedLines(ws, 'po-9', 'inv-9', 12, NOW)

    const rows = await rowsOf(ws, 'matched_line')
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(12)
    expect(rows[0].idempotencyKey).toBe('cmp:po-9:inv-9:2026-09-29')
  })

  it('happy: a photo check within quota is charged one with a photo: key', async () => {
    const ws = await seedWorkspace('trial')

    await gate.assertPhotoCheck(ws, NOW)

    const rows = await rowsOf(ws, 'photo_check')
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(1)
    expect(rows[0].idempotencyKey.startsWith('photo:')).toBe(true)
  })

  it('happy: AI cost under the cap passes', async () => {
    const ws = await seedWorkspace('trial')
    await seedRow(ws, 'llm_cost', 3_999_999)

    await expect(gate.assertAiBudget(ws, NOW)).resolves.toBeUndefined()
  })
})
