import { eq, like } from 'drizzle-orm'
import { db, invoices, pool, purchaseOrders, users, workspaceMembers, workspaces } from '@repo/db'
import { ProcurementParseService } from './procurement-parse.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspace(email: string, name: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return workspace
}

describe('ProcurementParseService', () => {
  let service: ProcurementParseService
  let queue: { add: jest.Mock; on: jest.Mock; getJob: jest.Mock }
  const prefix = `procurement-parse-spec-${Date.now()}-`

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn(), getJob: jest.fn().mockResolvedValue(null) }
    service = new ProcurementParseService(queue as any)
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('enqueues a purchase order with a deterministic jobId and pending status', async () => {
    const workspace = await seedWorkspace(`${prefix}po@example.com`, 'PO Enqueue')
    const [po] = await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'po.csv' }).returning()

    const result = await service.queueDoc('purchase_order', po.id)

    expect(result).toEqual({
      queued: true,
      kind: 'purchase_order',
      id: po.id,
      jobId: `procurement-parse:purchase_order:${po.id}`,
    })
    expect(queue.add).toHaveBeenCalledWith(
      { kind: 'purchase_order', id: po.id },
      expect.objectContaining({ jobId: `procurement-parse:purchase_order:${po.id}`, attempts: 3 }),
    )

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('pending')
    expect(row.queueJobId).toBe(`procurement-parse:purchase_order:${po.id}`)
  })

  it('enqueues an invoice with a deterministic jobId', async () => {
    const workspace = await seedWorkspace(`${prefix}inv@example.com`, 'Invoice Enqueue')
    const [invoice] = await db.insert(invoices).values({ workspaceId: workspace.id, name: 'invoice.csv' }).returning()

    const result = await service.queueDoc('invoice', invoice.id)

    expect(result.jobId).toBe(`procurement-parse:invoice:${invoice.id}`)
    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(row.status).toBe('pending')
  })

  it('marks the purchase order failed when the queue add throws', async () => {
    const workspace = await seedWorkspace(`${prefix}po-fail@example.com`, 'PO Enqueue Fail')
    const [po] = await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'po.csv' }).returning()
    queue.add.mockRejectedValue(new Error('queue down'))

    await expect(service.queueDoc('purchase_order', po.id)).rejects.toThrow('queue down')

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('reconcile marks a stale pending purchase order failed when its Bull job is gone', async () => {
    const workspace = await seedWorkspace(`${prefix}po-stale@example.com`, 'PO Stale')
    const staleEnqueuedAt = new Date(Date.now() - 3 * 60_000)
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        workspaceId: workspace.id,
        name: 'po.csv',
        status: 'pending',
        queueJobId: 'procurement-parse:purchase_order:missing',
        enqueuedAt: staleEnqueuedAt,
      })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('reconciliation')
  })

  it('reconcile leaves a fresh pending row untouched', async () => {
    const workspace = await seedWorkspace(`${prefix}po-fresh@example.com`, 'PO Fresh')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'pending', enqueuedAt: new Date() })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('pending')
  })
})
