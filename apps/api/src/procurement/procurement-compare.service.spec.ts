import { eq, like } from 'drizzle-orm'
import {
  db,
  goodsReceipts,
  invoices,
  pool,
  purchaseOrders,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { ProcurementCompareService } from './procurement-compare.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, membership.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
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

describe('ProcurementCompareService', () => {
  let service: ProcurementCompareService
  let queue: { add: jest.Mock; on: jest.Mock; getJob: jest.Mock }
  const prefix = `procurement-compare-spec-${Date.now()}-`

  beforeEach(() => {
    process.env.PROCUREMENT_AUTO_COMPARE_ENABLED = 'true'
    queue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn(), getJob: jest.fn().mockResolvedValue(null) }
    service = new ProcurementCompareService(queue as never)
  })

  afterAll(async () => {
    delete process.env.PROCUREMENT_AUTO_COMPARE_ENABLED
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedPair(
    email: string,
    name: string,
    opts: { invoiceStatus?: 'pending' | 'done'; link?: boolean } = {},
  ) {
    const workspace = await seedWorkspace(email, name)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({
        workspaceId: workspace.id,
        name: 'invoice.csv',
        status: opts.invoiceStatus ?? 'done',
        purchaseOrderId: opts.link === false ? null : po.id,
      })
      .returning()
    return { workspace, po, invoice }
  }

  // The id a job SHOULD carry: the pair, plus the newest `updated_at` of
  // everything feeding it. Recomputed from the database rather than captured at
  // seed time, because Postgres — not the test — decides those timestamps.
  async function expectedJobId(purchaseOrderId: string, invoiceId: string) {
    const [po] = await db
      .select({ updatedAt: purchaseOrders.updatedAt, workspaceId: purchaseOrders.workspaceId })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
    const [invoice] = await db
      .select({ updatedAt: invoices.updatedAt })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
    const receipts = await db
      .select({ updatedAt: goodsReceipts.updatedAt, status: goodsReceipts.status })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.purchaseOrderId, purchaseOrderId))
    const stamps = [po.updatedAt.getTime(), invoice.updatedAt.getTime()].concat(
      receipts.filter((receipt) => receipt.status === 'done').map((receipt) => receipt.updatedAt.getTime()),
    )
    return `procurement-compare:${purchaseOrderId}:${invoiceId}:${Math.max(...stamps)}`
  }

  it('enqueues one comparison per linked invoice when a purchase order finishes parsing', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}po@example.com`, 'PO Fan-out')
    const [second] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'invoice-2.csv', status: 'done', purchaseOrderId: po.id })
      .returning()

    await service.enqueueForDocument('purchase_order', po.id)

    expect(queue.add).toHaveBeenCalledTimes(2)
    const jobIds = queue.add.mock.calls.map((call) => call[1].jobId).sort()
    expect(jobIds).toEqual(
      [await expectedJobId(po.id, invoice.id), await expectedJobId(po.id, second.id)].sort(),
    )
    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.id, purchaseOrderId: po.id }),
      expect.objectContaining({ attempts: 2 }),
    )
  })

  it('enqueues the one pair when an invoice finishes parsing', async () => {
    const { po, invoice } = await seedPair(`${prefix}inv@example.com`, 'Invoice Trigger')

    await service.enqueueForDocument('invoice', invoice.id)

    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add.mock.calls[0][1].jobId).toBe(await expectedJobId(po.id, invoice.id))
  })

  // A receipt has no invoice of its own — it answers a purchase order, and the
  // comparison it affects is that order against each of its invoices.
  it('fans out over the purchase order’s invoices when a goods receipt finishes parsing', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}grn@example.com`, 'GRN Trigger')
    const [grn] = await db
      .insert(goodsReceipts)
      .values({
        workspaceId: workspace.id,
        purchaseOrderId: po.id,
        name: 'grn.csv',
        grnNumber: 'GRN-1',
        status: 'done',
      })
      .returning()

    await service.enqueueForDocument('goods_receipt', grn.id)

    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add.mock.calls[0][1].jobId).toBe(await expectedJobId(po.id, invoice.id))
  })

  // The id is what stops a burst of parses from piling up duplicate work, and
  // what stops a CHANGED state from being swallowed by a job already in flight:
  // a fixed id would hand the second enqueue back the first job, which has
  // already read the old lines.
  it('changes the job id when an input changes, so a newer state is never coalesced away', async () => {
    const { po, invoice } = await seedPair(`${prefix}version@example.com`, 'Versioned Id')

    await service.enqueueForDocument('purchase_order', po.id)
    const firstId = queue.add.mock.calls[0][1].jobId

    await db
      .update(invoices)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(invoices.id, invoice.id))
    await service.enqueueForDocument('purchase_order', po.id)
    const secondId = queue.add.mock.calls[1][1].jobId

    expect(secondId).not.toBe(firstId)
    expect(secondId).toBe(await expectedJobId(po.id, invoice.id))
  })

  // The receipt's own parse completion re-enqueues, so waiting costs nothing
  // and comparing now would produce a verdict computed without it — or worse,
  // from the rows a previous attempt left behind.
  it('defers while a linked goods receipt is still parsing', async () => {
    const { workspace, po } = await seedPair(`${prefix}grnwait@example.com`, 'Receipt Still Parsing')
    await db.insert(goodsReceipts).values({
      workspaceId: workspace.id,
      purchaseOrderId: po.id,
      name: 'grn.csv',
      grnNumber: 'GRN-1',
      status: 'processing',
    })

    await service.enqueueForDocument('purchase_order', po.id)

    expect(queue.add).not.toHaveBeenCalled()
  })

  // A failed receipt is NOT deferred for. Nothing is coming to re-enqueue, so
  // waiting for it means never comparing at all — and since S8 commit 1 its
  // lines are excluded from the comparison anyway.
  it('does not defer for a receipt whose parse failed', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}grnfailed@example.com`, 'Receipt Failed')
    await db.insert(goodsReceipts).values({
      workspaceId: workspace.id,
      purchaseOrderId: po.id,
      name: 'grn.csv',
      grnNumber: 'GRN-1',
      status: 'failed',
    })

    await service.enqueueForDocument('purchase_order', po.id)

    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add.mock.calls[0][1].jobId).toBe(await expectedJobId(po.id, invoice.id))
  })

  // compare() would refuse these anyway; enqueuing them would only manufacture
  // failed jobs and noise.
  it('enqueues nothing when the counterpart has not finished parsing', async () => {
    const { po } = await seedPair(`${prefix}pending@example.com`, 'Pending Counterpart', { invoiceStatus: 'pending' })

    await service.enqueueForDocument('purchase_order', po.id)

    expect(queue.add).not.toHaveBeenCalled()
  })

  // The pre-0025 legacy shape. compare() still accepts a null link when a human
  // picks both sides, but there is nothing to discover from it automatically.
  it('enqueues nothing for an invoice that is linked to no purchase order', async () => {
    const { invoice } = await seedPair(`${prefix}nolink@example.com`, 'No Link', { link: false })

    await service.enqueueForDocument('invoice', invoice.id)

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('enqueues nothing at all while the feature flag is off', async () => {
    delete process.env.PROCUREMENT_AUTO_COMPARE_ENABLED
    const { po } = await seedPair(`${prefix}flagoff@example.com`, 'Flag Off')

    await service.enqueueForDocument('purchase_order', po.id)

    expect(queue.add).not.toHaveBeenCalled()
  })
})
