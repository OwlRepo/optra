import { and, eq, like } from 'drizzle-orm'
import { db, pool, usageEvents, users, workspaceMembers, workspaceSubscriptions, workspaces } from '@repo/db'
import { UsageLedgerService } from './usage-ledger.service'

const PREFIX = `usage-ledger-spec-${Date.now()}-`
const START = new Date('2026-10-01T00:00:00.000Z')
const END = new Date('2026-11-01T00:00:00.000Z')
const WINDOW = { start: START, end: END }
const NOW = new Date('2026-10-08T12:00:00.000Z')

const ledger = new UsageLedgerService()

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

async function seedRow(
  workspaceId: string,
  kind: 'matched_line' | 'photo_check' | 'llm_cost',
  quantity: number,
  occurredAt: Date = NOW,
  key: string = `seed:${Math.random().toString(36).slice(2)}`,
) {
  await db.insert(usageEvents).values({ workspaceId, kind, quantity, idempotencyKey: key, occurredAt })
}

async function rowsOf(workspaceId: string) {
  return db.select().from(usageEvents).where(eq(usageEvents.workspaceId, workspaceId))
}

function reserve(
  workspaceId: string,
  over: Partial<Parameters<UsageLedgerService['reserve']>[0]> = {},
) {
  return ledger.reserve({
    workspaceId,
    kind: 'matched_line',
    idempotencyKey: `k:${Math.random().toString(36).slice(2)}`,
    quantity: 1,
    limit: 100,
    window: WINDOW,
    now: NOW,
    ...over,
  })
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

describe('UsageLedgerService', () => {
  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it('error: reserve over the limit inserts nothing and returns over', async () => {
    const ws = await seedWorkspace()
    await seedRow(ws, 'matched_line', 90)

    const result = await reserve(ws, { quantity: 20, limit: 100 })

    expect(result).toBe('over')
    const rows = await rowsOf(ws)
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(90)
  })

  it('error: reserve with a quantity above the whole limit is over even when nothing is used', async () => {
    const ws = await seedWorkspace()

    const result = await reserve(ws, { quantity: 101, limit: 100 })

    expect(result).toBe('over')
    expect(await rowsOf(ws)).toHaveLength(0)
  })

  it("error: another workspace's rows never count toward this workspace's sum", async () => {
    const mine = await seedWorkspace()
    const theirs = await seedWorkspace()
    await seedRow(theirs, 'matched_line', 99)

    expect(await reserve(mine, { quantity: 50, limit: 100 })).toBe('charged')
    expect(await ledger.sumsByKind(mine, WINDOW)).toEqual({ matchedLines: 50, photoChecks: 0, llmCostMicroUsd: 0 })
    expect(await ledger.sumsByKind(theirs, WINDOW)).toEqual({ matchedLines: 99, photoChecks: 0, llmCostMicroUsd: 0 })
  })

  it('edge: the same idempotency key is a duplicate, inserts nothing and is allowed even when over the limit', async () => {
    const ws = await seedWorkspace()
    expect(await reserve(ws, { idempotencyKey: 'cmp:a:b', quantity: 80, limit: 100 })).toBe('charged')
    await seedRow(ws, 'matched_line', 50)

    const again = await reserve(ws, { idempotencyKey: 'cmp:a:b', quantity: 80, limit: 100 })

    expect(again).toBe('duplicate')
    expect(await rowsOf(ws)).toHaveLength(2)
  })

  it('edge: a null limit never refuses', async () => {
    const ws = await seedWorkspace()
    await seedRow(ws, 'photo_check', 1_000_000)

    expect(await reserve(ws, { kind: 'photo_check', quantity: 5000, limit: null })).toBe('charged')
    expect(await ledger.sumsByKind(ws, WINDOW)).toMatchObject({ photoChecks: 1_005_000 })
  })

  it('edge: reserving exactly up to the limit is charged and one more is over', async () => {
    const ws = await seedWorkspace()

    expect(await reserve(ws, { quantity: 100, limit: 100 })).toBe('charged')
    expect(await reserve(ws, { quantity: 1, limit: 100 })).toBe('over')
    expect(await rowsOf(ws)).toHaveLength(1)
  })

  it('edge: rows outside the period are not counted (a row at end excluded, at start included)', async () => {
    const ws = await seedWorkspace()
    await seedRow(ws, 'matched_line', 60, START)
    await seedRow(ws, 'matched_line', 60, END)
    await seedRow(ws, 'matched_line', 60, new Date(START.getTime() - 1))

    expect(await ledger.sumsByKind(ws, WINDOW)).toMatchObject({ matchedLines: 60 })
    expect(await reserve(ws, { quantity: 40, limit: 100 })).toBe('charged')
    expect(await reserve(ws, { quantity: 1, limit: 100 })).toBe('over')
  })

  it('edge: concurrent reserves for one workspace never exceed the limit (ten reserves of 30 against 100 charge exactly three)', async () => {
    const ws = await seedWorkspace()

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reserve(ws, { idempotencyKey: `race:${i}`, quantity: 30, limit: 100 })),
    )

    expect(results.filter((r) => r === 'charged')).toHaveLength(3)
    expect(results.filter((r) => r === 'over')).toHaveLength(7)
    expect(await ledger.sumsByKind(ws, WINDOW)).toMatchObject({ matchedLines: 90 })
  })

  it('edge: concurrent reserves of the same key charge once', async () => {
    const ws = await seedWorkspace()

    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserve(ws, { idempotencyKey: 'cmp:same:pair', quantity: 10, limit: 100 })),
    )

    expect(results.filter((r) => r === 'charged')).toHaveLength(1)
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(5)
    expect(await rowsOf(ws)).toHaveLength(1)
  })

  it('edge: two workspaces reserve independently', async () => {
    const a = await seedWorkspace()
    const b = await seedWorkspace()

    const results = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => reserve(a, { idempotencyKey: `a:${i}`, quantity: 50, limit: 100 })),
      ...Array.from({ length: 4 }, (_, i) => reserve(b, { idempotencyKey: `b:${i}`, quantity: 50, limit: 100 })),
    ])

    expect(results.filter((r) => r === 'charged')).toHaveLength(4)
    expect(await ledger.sumsByKind(a, WINDOW)).toMatchObject({ matchedLines: 100 })
    expect(await ledger.sumsByKind(b, WINDOW)).toMatchObject({ matchedLines: 100 })
  })

  it('regression: occurred_at is the app clock passed in, not the database default', async () => {
    const ws = await seedWorkspace()
    const clock = new Date('2026-03-04T05:06:07.000Z')

    await reserve(ws, { now: clock, window: { start: new Date('2026-03-01T00:00:00.000Z'), end: new Date('2026-04-01T00:00:00.000Z') } })
    await ledger.recordLlmCost({
      workspaceId: ws,
      meter: { total: 10, costMicroUsd: 5, inputTokens: 6, outputTokens: 4, dominantModel: 'gpt-4o' },
      now: clock,
    })

    const rows = await rowsOf(ws)
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.occurredAt.toISOString()).toBe(clock.toISOString())
  })

  it('regression: recordLlmCost stores micro-USD in quantity with the token split and the dominant model', async () => {
    const ws = await seedWorkspace()

    await ledger.recordLlmCost({
      workspaceId: ws,
      meter: { total: 1500, costMicroUsd: 7500, inputTokens: 1000, outputTokens: 500, dominantModel: 'gpt-4o' },
      now: NOW,
    })

    const [row] = await rowsOf(ws)
    expect(row.kind).toBe('llm_cost')
    expect(row.quantity).toBe(7500)
    expect(row.inputTokens).toBe(1000)
    expect(row.outputTokens).toBe(500)
    expect(row.model).toBe('gpt-4o')
    expect(row.idempotencyKey.startsWith('llm:')).toBe(true)
    expect(row.workspaceId).toBe(ws)
  })

  it('regression: recordLlmCost with a zero-token meter writes nothing', async () => {
    const ws = await seedWorkspace()

    await ledger.recordLlmCost({
      workspaceId: ws,
      meter: { total: 0, costMicroUsd: 0, inputTokens: 0, outputTokens: 0, dominantModel: null },
      now: NOW,
    })

    expect(await rowsOf(ws)).toHaveLength(0)
  })

  it('happy: reserve inserts one row and returns charged', async () => {
    const ws = await seedWorkspace()

    const result = await reserve(ws, { idempotencyKey: 'cmp:po-1:inv-1', quantity: 7, limit: 400 })

    expect(result).toBe('charged')
    const rows = await db
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.workspaceId, ws), eq(usageEvents.idempotencyKey, 'cmp:po-1:inv-1')))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'matched_line', quantity: 7 })
    expect(rows[0].occurredAt.toISOString()).toBe(NOW.toISOString())
  })

  it('happy: sumsByKind returns lines, photo checks and llm_cost micro-USD for the period', async () => {
    const ws = await seedWorkspace()
    await seedRow(ws, 'matched_line', 12)
    await seedRow(ws, 'matched_line', 8)
    await seedRow(ws, 'photo_check', 3)
    await seedRow(ws, 'llm_cost', 4_500_000)
    await seedRow(ws, 'llm_cost', 500_000)

    expect(await ledger.sumsByKind(ws, WINDOW)).toEqual({ matchedLines: 20, photoChecks: 3, llmCostMicroUsd: 5_000_000 })
    expect(await ledger.sumsByKind(await seedWorkspace(), WINDOW)).toEqual({ matchedLines: 0, photoChecks: 0, llmCostMicroUsd: 0 })
  })
})
