import { randomUUID } from 'crypto'
import { eq, like } from 'drizzle-orm'
import {
  comparisonRuns,
  db,
  discrepancyDecisions,
  discrepancyFlags,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  pool,
  poLineItems,
  purchaseOrders,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { ComparisonService } from './comparison.service'
import { ProcurementCompareProcessor } from './procurement-compare.processor'
import { ProcurementCompareService } from './procurement-compare.service'
import { DuckDbQueryService, SqlExecutionError } from '../structured-query/duckdb-query.service'
import { EventsService } from '../events/events.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(discrepancyDecisions).where(eq(discrepancyDecisions.workspaceId, membership.workspaceId))
      await db.delete(discrepancyFlags).where(eq(discrepancyFlags.workspaceId, membership.workspaceId))
      await db.delete(comparisonRuns).where(eq(comparisonRuns.workspaceId, membership.workspaceId))
      await db.delete(goodsReceiptLineItems).where(eq(goodsReceiptLineItems.workspaceId, membership.workspaceId))
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, membership.workspaceId))
      await db.delete(poLineItems).where(eq(poLineItems.workspaceId, membership.workspaceId))
      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.workspaceId, membership.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

describe('ProcurementCompareProcessor', () => {
  let processor: ProcurementCompareProcessor
  let events: { record: jest.Mock }
  const prefix = `procurement-compare-processor-spec-${Date.now()}-`

  beforeEach(() => {
    const compareService = new ProcurementCompareService({ add: jest.fn(), on: jest.fn() } as never)
    events = { record: jest.fn().mockResolvedValue(undefined) }
    processor = new ProcurementCompareProcessor(
      new ComparisonService(new DuckDbQueryService()),
      compareService,
      events as unknown as EventsService,
    )
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedPair(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done', rowCount: 1 })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({
        workspaceId: workspace.id,
        name: 'invoice.csv',
        status: 'done',
        rowCount: 1,
        purchaseOrderId: po.id,
      })
      .returning()
    await db.insert(poLineItems).values({
      workspaceId: workspace.id,
      purchaseOrderId: po.id,
      lineNumber: 1,
      sku: 'A1',
      quantity: '10',
      unitPrice: '5.00',
    })
    await db.insert(invoiceLineItems).values({
      workspaceId: workspace.id,
      invoiceId: invoice.id,
      lineNumber: 1,
      sku: 'A1',
      quantity: '8',
      unitPrice: '5.00',
    })
    return { workspace, po, invoice }
  }

  const pairJob = (workspaceId: string, purchaseOrderId: string, invoiceId: string) =>
    ({ data: { workspaceId, purchaseOrderId, invoiceId } }) as never

  const runsFor = (purchaseOrderId: string) =>
    db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, purchaseOrderId))

  it('compares the pair and records the run as automatic', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}run@example.com`, 'Auto Run')

    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    const runs = await runsFor(po.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('succeeded')
    // No user behind it — that is what distinguishes an automatic run, and
    // S7's review panel already renders a null initiator as "automatic".
    expect(runs[0].initiatedBy).toBeNull()
  })

  // The guard that keeps append-only runs from growing without bound. Every run
  // is permanent evidence, and POLICY v1 #9 then refuses to hard-delete any
  // document it referenced — so repeating a comparison nothing changed for is
  // not merely wasted work.
  it('skips when the last succeeded run is newer than everything feeding it', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}skip@example.com`, 'Skip Unchanged')

    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))
    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    expect(await runsFor(po.id)).toHaveLength(1)
  })

  it('compares again once a document has actually changed', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}changed@example.com`, 'Changed')
    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    await db
      .update(invoices)
      .set({ updatedAt: new Date(Date.now() + 1000) })
      .where(eq(invoices.id, invoice.id))
    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    expect(await runsFor(po.id)).toHaveLength(2)
  })

  // The case a freshness check that only looked at the two named documents
  // would miss: a receipt is neither of them, but it changes the verdict.
  it('compares again when a goods receipt arrived after the last run', async () => {
    const { workspace, po, invoice } = await seedPair(`${prefix}grn@example.com`, 'Receipt After Run')
    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    await db.insert(goodsReceipts).values({
      workspaceId: workspace.id,
      purchaseOrderId: po.id,
      name: 'grn.csv',
      grnNumber: 'GRN-1',
      status: 'done',
      updatedAt: new Date(Date.now() + 1000),
    })
    await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

    expect(await runsFor(po.id)).toHaveLength(2)
  })

  // Correctness of the retry split, in both directions. A permanent failure
  // that is rethrown retries until Bull gives up — and against a deleted
  // document it would race the e2e suite's own fixture cleanup into foreign-key
  // violations. A transient failure that is swallowed loses the comparison.
  describe('failure handling', () => {
    it('treats a document that is gone as permanent, and does not retry it', async () => {
      const { workspace, po } = await seedPair(`${prefix}missing@example.com`, 'Missing Document')

      await expect(processor.handlePair(pairJob(workspace.id, po.id, randomUUID()))).resolves.toBeUndefined()

      // compare() refuses before writing a run row, so there is nothing to show
      // a reviewer either.
      expect(await runsFor(po.id)).toHaveLength(0)
    })

    it('rethrows an engine failure, so Bull retries it', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}engine@example.com`, 'Engine Down')
      const failing = {
        runReadOnlyMultiTableQuery: jest.fn().mockRejectedValue(new SqlExecutionError('boom')),
      } as unknown as DuckDbQueryService
      const failingProcessor = new ProcurementCompareProcessor(
        new ComparisonService(failing),
        new ProcurementCompareService({ add: jest.fn(), on: jest.fn() } as never),
        events as unknown as EventsService,
      )

      await expect(failingProcessor.handlePair(pairJob(workspace.id, po.id, invoice.id))).rejects.toThrow()

      // The run row is written before the engine call, so the failed attempt
      // still leaves evidence that something tried.
      const runs = await runsFor(po.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe('failed')
    })
  })

  // Only automatic runs raise events. Someone who pressed Compare themselves
  // is already looking at the result.
  describe('workspace events (S8)', () => {
    it('announces a run that found something, against the run itself', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}evt-flagged@example.com`, 'Event Flagged')

      await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

      const [run] = await runsFor(po.id)
      expect(run.flagCount).toBeGreaterThan(0)
      expect(events.record).toHaveBeenCalledTimes(1)
      const [workspaceId, type, entityId, title, detail] = events.record.mock.calls[0]
      expect(workspaceId).toBe(workspace.id)
      expect(type).toBe('comparison_flagged')
      // The run, not the purchase order — the same choice `scrape_completed`
      // makes, and the row that holds the evidence.
      expect(entityId).toBe(run.id)
      expect(typeof title).toBe('string')
      expect(detail).toContain('1')
    })

    // unreadCount has no per-type filter and markSeen is one global watermark,
    // so an event for a clean run would climb the Overview badge with nothing
    // behind it to act on.
    it('says nothing when an automatic run finds nothing', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}evt-clean@example.com`, 'Event Clean')
      // Make the two sides agree, so the run succeeds with zero flags.
      await db.update(invoiceLineItems).set({ quantity: '10' }).where(eq(invoiceLineItems.invoiceId, invoice.id))

      await processor.handlePair(pairJob(workspace.id, po.id, invoice.id))

      const [run] = await runsFor(po.id)
      expect(run.status).toBe('succeeded')
      expect(run.flagCount).toBe(0)
      expect(events.record).not.toHaveBeenCalled()
    })

    it('announces a run that failed, against the failed run', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}evt-failed@example.com`, 'Event Failed')
      const failing = {
        runReadOnlyMultiTableQuery: jest.fn().mockRejectedValue(new SqlExecutionError('boom')),
      } as unknown as DuckDbQueryService
      const failingProcessor = new ProcurementCompareProcessor(
        new ComparisonService(failing),
        new ProcurementCompareService({ add: jest.fn(), on: jest.fn() } as never),
        events as unknown as EventsService,
      )

      await expect(failingProcessor.handlePair(pairJob(workspace.id, po.id, invoice.id))).rejects.toThrow()

      const [run] = await runsFor(po.id)
      expect(run.status).toBe('failed')
      expect(events.record).toHaveBeenCalledTimes(1)
      const [, type, entityId] = events.record.mock.calls[0]
      expect(type).toBe('comparison_failed')
      expect(entityId).toBe(run.id)
    })

    // Same discipline as every existing EventsService caller: the terminal
    // state is already written, so a feed that refuses an entry must not undo
    // a comparison that really happened.
    it('keeps the run when the event cannot be written', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}evt-throws@example.com`, 'Event Throws')
      events.record.mockRejectedValue(new Error('events table is unreachable'))

      await expect(processor.handlePair(pairJob(workspace.id, po.id, invoice.id))).resolves.toBeUndefined()

      const [run] = await runsFor(po.id)
      expect(run.status).toBe('succeeded')
    })

    it('says nothing about a document that was deleted before the job ran', async () => {
      const { workspace, po } = await seedPair(`${prefix}evt-missing@example.com`, 'Event Missing')

      await processor.handlePair(pairJob(workspace.id, po.id, randomUUID()))

      // No run row exists to point an event at, and the pair should never have
      // resolved in the first place — that is a line for the log, not the feed.
      expect(events.record).not.toHaveBeenCalled()
    })
  })

  describe('stale run sweep', () => {
    it('fails a run that never finished and leaves a fresh one alone', async () => {
      const { workspace, po, invoice } = await seedPair(`${prefix}sweep@example.com`, 'Sweep')
      const [abandoned] = await db
        .insert(comparisonRuns)
        .values({
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          status: 'running',
          startedAt: new Date(Date.now() - 60 * 60_000),
        })
        .returning()
      const [fresh] = await db
        .insert(comparisonRuns)
        .values({
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          status: 'running',
        })
        .returning()

      await processor.handleReconcile()

      const [swept] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, abandoned.id))
      expect(swept.status).toBe('failed')
      expect(swept.finishedAt).not.toBeNull()
      // Client-safe: a reference id, never the engine's own text.
      expect(swept.lastError).toMatch(/^Comparison did not finish\. Reference: [0-9a-f]{8}$/)

      const [untouched] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, fresh.id))
      expect(untouched.status).toBe('running')
    })
  })
})
