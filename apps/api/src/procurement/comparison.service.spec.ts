import { eq, like } from 'drizzle-orm'
import {
  comparisonRuns,
  db,
  discrepancyDecisions,
  discrepancyFlags,
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
import { DuckDbQueryService, SqlExecutionError } from '../structured-query/duckdb-query.service'

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

async function seedWorkspace(email: string, name: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { user, workspace }
}

interface FixtureItem {
  sku?: string
  description?: string
  quantity?: string
  unitPrice?: string
}

describe('ComparisonService', () => {
  let service: ComparisonService
  const prefix = `comparison-spec-${Date.now()}-`

  beforeEach(() => {
    service = new ComparisonService(new DuckDbQueryService())
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedReadyPoAndInvoice(workspaceId: string, poItems: FixtureItem[], invItems: FixtureItem[]) {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId, name: 'po.csv', status: 'done', rowCount: poItems.length })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId, name: 'invoice.csv', status: 'done', rowCount: invItems.length })
      .returning()

    if (poItems.length > 0) {
      await db.insert(poLineItems).values(
        poItems.map((item, index) => ({
          workspaceId,
          purchaseOrderId: po.id,
          lineNumber: index + 1,
          sku: item.sku ?? null,
          description: item.description ?? null,
          quantity: item.quantity ?? null,
          unitPrice: item.unitPrice ?? null,
        })),
      )
    }
    if (invItems.length > 0) {
      await db.insert(invoiceLineItems).values(
        invItems.map((item, index) => ({
          workspaceId,
          invoiceId: invoice.id,
          lineNumber: index + 1,
          sku: item.sku ?? null,
          description: item.description ?? null,
          quantity: item.quantity ?? null,
          unitPrice: item.unitPrice ?? null,
        })),
      )
    }

    return { po, invoice }
  }

  it('flags quantity mismatch, price mismatch, missing-on-invoice, and missing-on-po in one comparison', async () => {
    const { workspace } = await seedWorkspace(`${prefix}mixed@example.com`, 'Mixed Flags')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: 'QTY-1', quantity: '10', unitPrice: '5.00' },
        { sku: 'PRICE-1', quantity: '2', unitPrice: '9.99' },
        { sku: 'PO-ONLY', quantity: '1', unitPrice: '1.00' },
      ],
      [
        { sku: 'QTY-1', quantity: '8', unitPrice: '5.00' },
        { sku: 'PRICE-1', quantity: '2', unitPrice: '12.00' },
        { sku: 'INV-ONLY', quantity: '1', unitPrice: '1.00' },
      ],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.counts).toEqual({
      quantity_mismatch: 1,
      price_mismatch: 1,
      missing_on_invoice: 1,
      missing_on_po: 1,
    })
    const skus = result.flags.map((f) => f.sku).sort()
    expect(skus).toEqual(['INV-ONLY', 'PO-ONLY', 'PRICE-1', 'QTY-1'])
  })

  it('matches on description when SKU is absent on both sides', async () => {
    const { workspace } = await seedWorkspace(`${prefix}desc-fallback@example.com`, 'Desc Fallback')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ description: 'Steel Bracket', quantity: '5', unitPrice: '2.00' }],
      [{ description: 'Steel Bracket', quantity: '5', unitPrice: '2.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(0)
  })

  it('returns zero flags when PO and invoice are identical', async () => {
    const { workspace } = await seedWorkspace(`${prefix}identical@example.com`, 'Identical')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(0)
    expect(result.counts).toEqual({
      quantity_mismatch: 0,
      price_mismatch: 0,
      missing_on_invoice: 0,
      missing_on_po: 0,
    })
  })

  it('rejects comparing a purchase order that belongs to another workspace', async () => {
    const { workspace: mine } = await seedWorkspace(`${prefix}iso-mine@example.com`, 'Iso Mine')
    const { workspace: other } = await seedWorkspace(`${prefix}iso-other@example.com`, 'Iso Other')
    const { po } = await seedReadyPoAndInvoice(other.id, [{ sku: 'A1', quantity: '1', unitPrice: '1' }], [])
    const { invoice } = await seedReadyPoAndInvoice(mine.id, [], [{ sku: 'A1', quantity: '1', unitPrice: '1' }])

    await expect(service.compare(mine.id, po.id, invoice.id)).rejects.toThrow('Purchase order not found')
  })

  // Until S1 this asserted that a re-compare *replaced* the prior flags, and
  // it was the delete that made that true — the same delete that destroyed
  // dismissals. The property worth keeping is that a re-compare does not
  // duplicate what the user sees; it is now the current-run query that
  // provides it, while the earlier run's flags are retained rather than
  // deleted.
  it('re-comparing the same PO/invoice pair retains prior flags and still shows one set', async () => {
    const { workspace, user } = await seedWorkspace(`${prefix}rerun@example.com`, 'Rerun')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )

    await service.compare(workspace.id, po.id, invoice.id, user.id)
    await service.compare(workspace.id, po.id, invoice.id, user.id)

    const stored = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
    expect(stored).toHaveLength(2)

    expect(await service.listFlags(workspace.id, {})).toHaveLength(1)
  })

  it('rejects comparing when the purchase order has not finished parsing', async () => {
    const { workspace } = await seedWorkspace(`${prefix}not-done@example.com`, 'Not Done')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'processing' })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'invoice.csv', status: 'done' })
      .returning()

    await expect(service.compare(workspace.id, po.id, invoice.id)).rejects.toThrow('has not finished parsing yet')
  })

  it('rejects comparing when either document has no parsed line items', async () => {
    const { workspace } = await seedWorkspace(`${prefix}empty-items@example.com`, 'Empty Items')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done', rowCount: 0 })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'invoice.csv', status: 'done', rowCount: 0 })
      .returning()

    await expect(service.compare(workspace.id, po.id, invoice.id)).rejects.toThrow('must have parsed line items')
  })

  // Regression: DuckDB's read_csv_auto infers each CSV's column types independently.
  // An all-numeric SKU column on one side infers BIGINT while an empty/text SKU column
  // on the other infers VARCHAR, and COALESCE(po_sku, inv_sku) then fails to bind:
  // "Cannot mix values of type BIGINT and VARCHAR in COALESCE operator". This is the
  // exact shape of a real Cin7 PO (numeric SKUs) compared against a vendor invoice
  // (no SKUs) — it 500'd in production.
  it('compares a numeric-SKU purchase order against an invoice with no SKUs', async () => {
    const { workspace } = await seedWorkspace(`${prefix}numeric-sku@example.com`, 'Numeric SKU')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: '123456', description: 'Product A', quantity: '27', unitPrice: '220.00' },
        { sku: '789012', description: 'Product B', quantity: '3', unitPrice: '55.00' },
      ],
      [{ description: 'Laundry service (towels)', quantity: '71', unitPrice: '0.50' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    // Nothing matches on either key, so every line is missing on the opposite side.
    expect(result.counts.missing_on_invoice).toBe(2)
    expect(result.counts.missing_on_po).toBe(1)
    expect(result.flags.every((flag) => flag.sku === null || typeof flag.sku === 'string')).toBe(true)
  })

  it('compares when both sides have numeric SKUs', async () => {
    const { workspace } = await seedWorkspace(`${prefix}numeric-both@example.com`, 'Numeric Both')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: '123456', description: 'Product A', quantity: '27', unitPrice: '220.00' }],
      [{ sku: '123456', description: 'Product A', quantity: '25', unitPrice: '220.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.counts.quantity_mismatch).toBe(1)
    expect(result.flags[0].sku).toBe('123456')
  })

  // The engine message can quote cell values from the compared documents, so it
  // stays server-side. The client gets a stable text plus a reference id.
  it('surfaces a DuckDB engine failure as 503 with a client-safe reference, never the raw engine text', async () => {
    const { workspace } = await seedWorkspace(`${prefix}engine-fail@example.com`, 'Engine Fail')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A-1', description: 'Widget', quantity: '2', unitPrice: '10.00' }],
      [{ sku: 'A-1', description: 'Widget', quantity: '3', unitPrice: '10.00' }],
    )

    const failing = new DuckDbQueryService()
    jest
      .spyOn(failing, 'runReadOnlyMultiTableQuery')
      .mockRejectedValue(new SqlExecutionError('Conversion Error: Could not convert string "SECRET-CELL" to DOUBLE'))
    const failingService = new ComparisonService(failing)

    const error = await failingService.compare(workspace.id, po.id, invoice.id).then(
      () => null,
      (caught: unknown) => caught as { status: number; message: string },
    )

    expect(error?.status).toBe(503)
    expect(error?.message).toMatch(/^Comparison engine failed\. Reference: [0-9a-f]{8}$/)
    expect(error?.message).not.toContain('SECRET-CELL')
  })

  it('ignores line items that carry another workspace id under this workspace’s document', async () => {
    const { workspace: mine } = await seedWorkspace(`${prefix}child-scope-mine@example.com`, 'Child Scope Mine')
    const { workspace: other } = await seedWorkspace(`${prefix}child-scope-other@example.com`, 'Child Scope Other')
    const { po, invoice } = await seedReadyPoAndInvoice(
      mine.id,
      [{ sku: 'A1', quantity: '1', unitPrice: '1.00' }],
      [{ sku: 'A1', quantity: '1', unitPrice: '1.00' }],
    )
    await db.insert(poLineItems).values({
      workspaceId: other.id,
      purchaseOrderId: po.id,
      lineNumber: 2,
      sku: 'FOREIGN-1',
      quantity: '5',
      unitPrice: '5.00',
    })

    const result = await service.compare(mine.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(0)
  })

  it('keeps the prior flag set when inserting the new one fails', async () => {
    const { workspace } = await seedWorkspace(`${prefix}atomic@example.com`, 'Atomic')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )
    await service.compare(workspace.id, po.id, invoice.id)

    const internals = service as unknown as {
      toFlagValues: (...args: unknown[]) => Record<string, unknown>
    }
    const original = internals.toFlagValues.bind(service)
    jest
      .spyOn(internals, 'toFlagValues')
      .mockImplementation((...args: unknown[]) => ({ ...original(...args), flagType: 'not_a_flag_type' }))

    await expect(service.compare(workspace.id, po.id, invoice.id)).rejects.toThrow()

    const flags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
    expect(flags).toHaveLength(1)
    expect(flags[0].flagType).toBe('quantity_mismatch')
  })

  // Before S1 this asserted "exactly one flag set", because a re-compare
  // deleted the previous one. Under append-only runs four compares correctly
  // produce four runs and four flag sets; what must stay singular is what the
  // user sees, which is the current run. The PO row lock is kept so the runs
  // cannot tie on created_at and leave "latest" ambiguous.
  it('gives each concurrent compare its own run and still shows one current flag set', async () => {
    const { workspace, user } = await seedWorkspace(`${prefix}concurrent@example.com`, 'Concurrent')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )

    await Promise.all([
      service.compare(workspace.id, po.id, invoice.id, user.id),
      service.compare(workspace.id, po.id, invoice.id, user.id),
      service.compare(workspace.id, po.id, invoice.id, user.id),
      service.compare(workspace.id, po.id, invoice.id, user.id),
    ])

    const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, po.id))
    expect(runs).toHaveLength(4)
    expect(runs.every((run) => run.status === 'succeeded')).toBe(true)

    const flags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
    expect(flags).toHaveLength(4)

    expect(await service.listFlags(workspace.id, {})).toHaveLength(1)
  })

  describe('comparison runs (S1)', () => {
    it('keeps a dismissed flag when the same pair is compared again', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-keeps-dismissal@example.com`, 'Run Keeps Dismissal')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const first = await service.compare(workspace.id, po.id, invoice.id, user.id)
      await service.dismissFlag(workspace.id, first.flags[0].id, user.id)

      await service.compare(workspace.id, po.id, invoice.id, user.id)

      const [dismissed] = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.id, first.flags[0].id))
      expect(dismissed).toBeDefined()
      expect(dismissed.status).toBe('dismissed')
      expect(dismissed.dismissedBy).toBe(user.id)
    })

    it('appends a second run and leaves the first run\'s flags in place', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-appends@example.com`, 'Run Appends')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const first = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const second = await service.compare(workspace.id, po.id, invoice.id, user.id)

      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, po.id))
      expect(runs).toHaveLength(2)
      expect(first.runId).not.toBe(second.runId)

      const allFlags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
      expect(allFlags).toHaveLength(2)
      expect(allFlags.filter((flag) => flag.comparisonRunId === first.runId)).toHaveLength(1)
    })

    it('records who ran it, the line counts it read, and the flag count it wrote', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-counts@example.com`, 'Run Counts')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '10', unitPrice: '5.00' },
          { sku: 'B2', quantity: '1', unitPrice: '2.00' },
          { sku: 'C3', quantity: '4', unitPrice: '3.00' },
        ],
        [
          { sku: 'A1', quantity: '8', unitPrice: '5.00' },
          { sku: 'B2', quantity: '1', unitPrice: '2.00' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))

      expect(run.status).toBe('succeeded')
      expect(run.mode).toBe('two_way')
      expect(run.strategyVersion).toBe(1)
      expect(run.initiatedBy).toBe(user.id)
      expect(run.poLineCount).toBe(3)
      expect(run.invoiceLineCount).toBe(2)
      expect(run.flagCount).toBe(2)
      expect(run.finishedAt).not.toBeNull()
      expect(run.lastError).toBeNull()
    })

    it('records a failed run and writes no flags when the engine fails', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-failed@example.com`, 'Run Failed')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '2', unitPrice: '10.00' }],
        [{ sku: 'A1', quantity: '3', unitPrice: '10.00' }],
      )

      const failing = new DuckDbQueryService()
      jest.spyOn(failing, 'runReadOnlyMultiTableQuery').mockRejectedValue(new SqlExecutionError('boom'))

      await expect(new ComparisonService(failing).compare(workspace.id, po.id, invoice.id, user.id)).rejects.toThrow()

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, po.id))
      expect(run.status).toBe('failed')
      expect(run.flagCount).toBeNull()
      expect(run.lastError).not.toBeNull()

      const flags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
      expect(flags).toHaveLength(0)
    })

    it('lists only the latest succeeded run by default, and any run on request', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-current@example.com`, 'Run Current')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const first = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const second = await service.compare(workspace.id, po.id, invoice.id, user.id)

      const current = await service.listFlags(workspace.id, {})
      expect(current).toHaveLength(1)
      expect(current[0].comparisonRunId).toBe(second.runId)

      const historical = await service.listFlags(workspace.id, { runId: first.runId })
      expect(historical).toHaveLength(1)
      expect(historical[0].comparisonRunId).toBe(first.runId)
    })

    it('treats pre-run flags as current until that pair has a succeeded run', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}run-legacy@example.com`, 'Run Legacy')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      // A flag written before S1 existed: no run to point at.
      const [legacy] = await db
        .insert(discrepancyFlags)
        .values({
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          sku: 'A1',
          flagType: 'quantity_mismatch',
          reason: 'Seeded before comparison runs existed.',
        })
        .returning()

      expect(await service.listFlags(workspace.id, {})).toEqual([expect.objectContaining({ id: legacy.id })])

      const run = await service.compare(workspace.id, po.id, invoice.id, user.id)

      const current = await service.listFlags(workspace.id, {})
      expect(current).toHaveLength(1)
      expect(current[0].comparisonRunId).toBe(run.runId)
      expect(current.map((flag) => flag.id)).not.toContain(legacy.id)

      const [stillThere] = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.id, legacy.id))
      expect(stillThere).toBeDefined()
    })
  })

  describe('decisions and audit (S2)', () => {
    async function seedFlag(email: string, name: string) {
      const { workspace, user } = await seedWorkspace(email, name)
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      const result = await service.compare(workspace.id, po.id, invoice.id, user.id)
      return { workspace, user, po, invoice, flag: result.flags[0], runId: result.runId }
    }

    it('records a decision, closes the flag, and captures the actor role at decision time', async () => {
      const { workspace, user, flag, runId } = await seedFlag(`${prefix}decision-record@example.com`, 'Decision Record')

      const decision = await service.recordDecision(workspace.id, flag.id, user.id, {
        outcome: 'approved_exception',
        note: 'Agreed with the vendor over the phone.',
      })

      expect(decision.outcome).toBe('approved_exception')
      expect(decision.note).toBe('Agreed with the vendor over the phone.')
      expect(decision.actorUserId).toBe(user.id)
      expect(decision.actorRole).toBe('owner')
      expect(decision.comparisonRunId).toBe(runId)

      const [stored] = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.id, flag.id))
      expect(stored.status).toBe('dismissed')
    })

    it('returns the history oldest-first and never rewrites an earlier entry', async () => {
      const { workspace, user, flag } = await seedFlag(`${prefix}decision-history@example.com`, 'Decision History')

      await service.recordDecision(workspace.id, flag.id, user.id, { outcome: 'vendor_dispute', note: 'Raised with vendor.' })
      await service.recordDecision(workspace.id, flag.id, user.id, { outcome: 'resolved', note: 'Credit note received.' })

      const history = await service.listDecisions(workspace.id, flag.id)
      expect(history.map((entry) => entry.outcome)).toEqual(['vendor_dispute', 'resolved'])
      expect(history.map((entry) => entry.note)).toEqual(['Raised with vendor.', 'Credit note received.'])
    })

    it('rejects an empty note, so a decision always carries a reason', async () => {
      const { workspace, user, flag } = await seedFlag(`${prefix}decision-note@example.com`, 'Decision Note')

      await expect(
        service.recordDecision(workspace.id, flag.id, user.id, { outcome: 'resolved', note: '   ' }),
      ).rejects.toThrow('note is required')

      expect(await service.listDecisions(workspace.id, flag.id)).toHaveLength(0)
    })

    it('refuses a flag from another workspace and records nothing', async () => {
      const { flag } = await seedFlag(`${prefix}decision-foreign@example.com`, 'Decision Foreign')
      const { workspace: other, user: otherUser } = await seedWorkspace(
        `${prefix}decision-outsider@example.com`,
        'Decision Outsider',
      )

      await expect(
        service.recordDecision(other.id, flag.id, otherUser.id, { outcome: 'resolved', note: 'Not mine.' }),
      ).rejects.toThrow('Discrepancy flag not found')

      const rows = await db.select().from(discrepancyDecisions).where(eq(discrepancyDecisions.discrepancyFlagId, flag.id))
      expect(rows).toHaveLength(0)
    })

    it('writes exactly one false_positive decision when the legacy dismiss route is used', async () => {
      const { workspace, user, flag } = await seedFlag(`${prefix}decision-dismiss@example.com`, 'Decision Dismiss')

      await service.dismissFlag(workspace.id, flag.id, user.id)

      const history = await service.listDecisions(workspace.id, flag.id)
      expect(history).toHaveLength(1)
      expect(history[0].outcome).toBe('false_positive')
      expect(history[0].actorUserId).toBe(user.id)
      expect(history[0].note).toContain('Dismissed')
    })

    it('adds no second decision when an already-dismissed flag is dismissed again', async () => {
      const { workspace, user, flag } = await seedFlag(`${prefix}decision-redismiss@example.com`, 'Decision Redismiss')

      await service.dismissFlag(workspace.id, flag.id, user.id)
      await service.dismissFlag(workspace.id, flag.id, user.id)

      expect(await service.listDecisions(workspace.id, flag.id)).toHaveLength(1)
    })

    it('keeps decisions when the pair is compared again', async () => {
      const { workspace, user, po, invoice, flag } = await seedFlag(
        `${prefix}decision-rerun@example.com`,
        'Decision Rerun',
      )
      await service.recordDecision(workspace.id, flag.id, user.id, { outcome: 'resolved', note: 'Handled.' })

      await service.compare(workspace.id, po.id, invoice.id, user.id)

      const history = await service.listDecisions(workspace.id, flag.id)
      expect(history).toHaveLength(1)
      expect(history[0].outcome).toBe('resolved')
    })
  })

  describe('delta convention (S1)', () => {
    it('reports delta as invoice minus purchase order for quantity and price', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}delta-sign@example.com`, 'Delta Sign')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'QTY', quantity: '18', unitPrice: '1.00' },
          { sku: 'PRICE', quantity: '1', unitPrice: '312.50' },
        ],
        [
          { sku: 'QTY', quantity: '20', unitPrice: '1.00' },
          { sku: 'PRICE', quantity: '1', unitPrice: '338.00' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const bySku = new Map(result.flags.map((flag) => [flag.sku, flag]))

      // Invoice billed 20 against 18 ordered: the overage reads positive.
      expect(bySku.get('QTY')?.flagType).toBe('quantity_mismatch')
      expect(Number(bySku.get('QTY')?.delta)).toBe(2)
      // Invoice charged 338.00 against 312.50 agreed.
      expect(bySku.get('PRICE')?.flagType).toBe('price_mismatch')
      expect(Number(bySku.get('PRICE')?.delta)).toBe(25.5)
    })

    it('fills the present side and a signed delta on missing-side flags', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}delta-missing@example.com`, 'Delta Missing')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'ONLY-PO', quantity: '12', unitPrice: '1.00' }],
        [{ sku: 'ONLY-INV', quantity: '1', unitPrice: '285.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const bySku = new Map(result.flags.map((flag) => [flag.sku, flag]))

      const onlyPo = bySku.get('ONLY-PO')
      expect(onlyPo?.flagType).toBe('missing_on_invoice')
      expect(Number(onlyPo?.poValue)).toBe(12)
      expect(onlyPo?.invoiceValue).toBeNull()
      expect(Number(onlyPo?.delta)).toBe(-12)

      const onlyInvoice = bySku.get('ONLY-INV')
      expect(onlyInvoice?.flagType).toBe('missing_on_po')
      expect(onlyInvoice?.poValue).toBeNull()
      expect(Number(onlyInvoice?.invoiceValue)).toBe(1)
      expect(Number(onlyInvoice?.delta)).toBe(1)
    })
  })

  it('persists every discrepancy when a comparison produces more than 500 of them', async () => {
    const { workspace } = await seedWorkspace(`${prefix}over-500@example.com`, 'Over 500')
    const poItems: FixtureItem[] = []
    const invItems: FixtureItem[] = []
    for (let i = 0; i < 600; i++) {
      poItems.push({ sku: `BULK-${i}`, quantity: '1', unitPrice: '1.00' })
      invItems.push({ sku: `BULK-${i}`, quantity: '2', unitPrice: '1.00' })
    }
    const { po, invoice } = await seedReadyPoAndInvoice(workspace.id, poItems, invItems)

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.counts.quantity_mismatch).toBe(600)
    const flags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
    expect(flags).toHaveLength(600)
  })

  it('flags a line with neither SKU nor description as unmatchable, on its own document’s side', async () => {
    const { workspace } = await seedWorkspace(`${prefix}unkeyed@example.com`, 'Unkeyed')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: 'A1', quantity: '1', unitPrice: '1.00' },
        { quantity: '3', unitPrice: '2.00' },
      ],
      [{ sku: 'A1', quantity: '1', unitPrice: '1.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].flagType).toBe('missing_on_invoice')
    expect(result.flags[0].poLineItemId).not.toBeNull()
    expect(result.flags[0].reason).toContain('no SKU or description')
  })

  it('sums duplicate lines for the same item before comparing', async () => {
    const { workspace } = await seedWorkspace(`${prefix}dupe-sum@example.com`, 'Dupe Sum')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: 'D1', quantity: '5', unitPrice: '2.00' },
        { sku: 'D1', quantity: '5', unitPrice: '2.00' },
      ],
      [{ sku: 'D1', quantity: '10', unitPrice: '2.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(0)
  })

  it('reports one quantity flag, not a fan-out, when summed duplicates still disagree', async () => {
    const { workspace } = await seedWorkspace(`${prefix}dupe-diff@example.com`, 'Dupe Diff')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: 'D1', quantity: '5', unitPrice: '2.00' },
        { sku: 'D1', quantity: '5', unitPrice: '2.00' },
      ],
      [{ sku: 'D1', quantity: '8', unitPrice: '2.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].flagType).toBe('quantity_mismatch')
    expect(Number(result.flags[0].poValue)).toBe(10)
    expect(Number(result.flags[0].invoiceValue)).toBe(8)
    expect(result.flags[0].reason).toContain('2 purchase order lines')
  })

  it('flags an item whose own document lists more than one unit price', async () => {
    const { workspace } = await seedWorkspace(`${prefix}mixed-price@example.com`, 'Mixed Price')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [
        { sku: 'M1', quantity: '1', unitPrice: '2.00' },
        { sku: 'M1', quantity: '1', unitPrice: '3.00' },
      ],
      [{ sku: 'M1', quantity: '2', unitPrice: '2.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].flagType).toBe('price_mismatch')
    expect(result.flags[0].reason).toContain('multiple unit prices')
  })

  it('keeps a leading-zero SKU exactly as stored', async () => {
    const { workspace } = await seedWorkspace(`${prefix}leading-zero@example.com`, 'Leading Zero')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: '00123', quantity: '5', unitPrice: '1.00' }],
      [{ sku: '00123', quantity: '4', unitPrice: '1.00' }],
    )

    const result = await service.compare(workspace.id, po.id, invoice.id)

    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].sku).toBe('00123')
  })

  it('refuses to dismiss a flag from another workspace and leaves it open', async () => {
    const { workspace: owner } = await seedWorkspace(`${prefix}dismiss-owner@example.com`, 'Dismiss Owner')
    const { user: intruder, workspace: intruderWs } = await seedWorkspace(
      `${prefix}dismiss-intruder@example.com`,
      'Dismiss Intruder',
    )
    const { po, invoice } = await seedReadyPoAndInvoice(
      owner.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )
    const { flags } = await service.compare(owner.id, po.id, invoice.id)

    await expect(service.dismissFlag(intruderWs.id, flags[0].id, intruder.id)).rejects.toThrow(
      'Discrepancy flag not found',
    )

    const [stored] = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.id, flags[0].id))
    expect(stored.status).toBe('open')
    expect(stored.dismissedBy).toBeNull()
  })

  it('keeps the original dismisser when a dismissed flag is dismissed again', async () => {
    const { user: first, workspace } = await seedWorkspace(`${prefix}redismiss@example.com`, 'Redismiss')
    const [second] = await db
      .insert(users)
      .values({ email: `${prefix}redismiss-second@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: second.id, role: 'admin' })
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )
    const { flags } = await service.compare(workspace.id, po.id, invoice.id)

    const firstDismiss = await service.dismissFlag(workspace.id, flags[0].id, first.id)
    const secondDismiss = await service.dismissFlag(workspace.id, flags[0].id, second.id)

    expect(secondDismiss.status).toBe('dismissed')
    expect(secondDismiss.dismissedBy).toBe(first.id)
    expect(secondDismiss.dismissedAt?.getTime()).toBe(firstDismiss.dismissedAt?.getTime())
  })

  it('lists flags filtered by status and supports dismissing one', async () => {
    const { user, workspace } = await seedWorkspace(`${prefix}dismiss@example.com`, 'Dismiss Flow')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )
    await service.compare(workspace.id, po.id, invoice.id)

    const openFlags = await service.listFlags(workspace.id, { status: 'open' })
    expect(openFlags).toHaveLength(1)

    const dismissed = await service.dismissFlag(workspace.id, openFlags[0].id, user.id)
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.dismissedBy).toBe(user.id)

    const stillOpen = await service.listFlags(workspace.id, { status: 'open' })
    expect(stillOpen).toHaveLength(0)
  })
})
