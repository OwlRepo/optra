import { eq, like } from 'drizzle-orm'
import {
  comparisonRunGoodsReceipts,
  comparisonRuns,
  db,
  goodsReceiptLineItems,
  goodsReceipts,
  discrepancyDecisions,
  discrepancyFlags,
  invoiceLineItems,
  invoices,
  pool,
  poLineItems,
  purchaseOrders,
  users,
  vendorPriceTerms,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { COMPARISON_STRATEGY_VERSION, ComparisonService } from './comparison.service'
import { DuckDbQueryService, SqlExecutionError } from '../structured-query/duckdb-query.service'

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
  // S6 commit 2. Almost every fixture leaves this unset, which is the shape of
  // real data: `uom` arrived in S3a and only a source carrying a unit column
  // fills it. An unset unit must never read as a mismatch.
  uom?: string
}

describe('ComparisonService', () => {
  let service: ComparisonService
  const prefix = `comparison-spec-${Date.now()}-`

  beforeEach(() => {
    service = new ComparisonService(new DuckDbQueryService())
  })

  // No per-suite cleanup: unit tests run on a database recreated every run
  // (test/unit-global-setup.ts). This one issued up to ~2,400 sequential
  // deletes and exceeded Jest's 5 s hook timeout in CI.
  afterAll(async () => {
    await pool.end()
  })

  async function seedReadyPoAndInvoice(
    workspaceId: string,
    poItems: FixtureItem[],
    invItems: FixtureItem[],
    // S3b: when omitted the invoice carries no PO link, which is exactly the
    // legacy shape every pre-migration-0025 row has. compare() must keep
    // accepting it, so leaving this unset is the default on purpose.
    linkInvoiceToPo = false,
    // S6 commit 2. Both header currencies default to unstated, which is what
    // every pre-0025 document carries — so the currency check must stay silent
    // for every fixture that does not opt in.
    currencies: { po?: string | null; invoice?: string | null } = {},
  ) {
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        workspaceId,
        name: 'po.csv',
        status: 'done',
        rowCount: poItems.length,
        currency: currencies.po ?? null,
      })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({
        workspaceId,
        name: 'invoice.csv',
        status: 'done',
        rowCount: invItems.length,
        purchaseOrderId: linkInvoiceToPo ? po.id : null,
        currency: currencies.invoice ?? null,
      })
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
          uom: item.uom ?? null,
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
          uom: item.uom ?? null,
        })),
      )
    }

    return { po, invoice }
  }

  // Hoisted out of the three-way block: the needs-review tests below compare a
  // receipt's unit against the order's, so both blocks seed receipts.
  async function seedGoodsReceipt(
    workspaceId: string,
    purchaseOrderId: string,
    lines: { sku: string; quantityAccepted: string | null; uom?: string }[],
    grnNumber = 'GRN-1',
    status: 'pending' | 'processing' | 'done' | 'failed' = 'done',
  ) {
    const [grn] = await db
      .insert(goodsReceipts)
      .values({ workspaceId, purchaseOrderId, name: `${grnNumber}.csv`, grnNumber, status })
      .returning()
    if (lines.length > 0) {
      await db.insert(goodsReceiptLineItems).values(
        lines.map((line, index) => ({
          workspaceId,
          goodsReceiptId: grn.id,
          lineNumber: index + 1,
          sku: line.sku,
          quantityReceived: line.quantityAccepted,
          quantityAccepted: line.quantityAccepted,
          quantityRejected: null,
          uom: line.uom ?? null,
        })),
      )
    }
    return grn
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
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
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
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
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

    expect((await service.listFlags(workspace.id, {})).items).toHaveLength(1)
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

    expect((await service.listFlags(workspace.id, {})).items).toHaveLength(1)
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
      // The invariant is that a run records the engine that produced it, not
      // that the engine is forever version 1. The literal is pinned once, in
      // the S9 block that bumped it.
      expect(run.strategyVersion).toBe(COMPARISON_STRATEGY_VERSION)
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
      expect(current.items).toHaveLength(1)
      expect(current.items[0].comparisonRunId).toBe(second.runId)

      const historical = await service.listFlags(workspace.id, { runId: first.runId })
      expect(historical.items).toHaveLength(1)
      expect(historical.items[0].comparisonRunId).toBe(first.runId)
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

      expect((await service.listFlags(workspace.id, {})).items).toEqual([expect.objectContaining({ id: legacy.id })])

      const run = await service.compare(workspace.id, po.id, invoice.id, user.id)

      const current = await service.listFlags(workspace.id, {})
      expect(current.items).toHaveLength(1)
      expect(current.items[0].comparisonRunId).toBe(run.runId)
      expect(current.items.map((flag) => flag.id)).not.toContain(legacy.id)

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
    expect(openFlags.items).toHaveLength(1)

    const dismissed = await service.dismissFlag(workspace.id, openFlags.items[0].id, user.id)
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.dismissedBy).toBe(user.id)

    const stillOpen = await service.listFlags(workspace.id, { status: 'open' })
    expect(stillOpen.items).toHaveLength(0)
  })

  // S6. The receiving side. What makes these worth writing rather than trusting
  // the SQL: every one of them is a case where a plausible implementation gives
  // a confidently wrong answer rather than an error.
  describe('three-way comparison (S6)', () => {
    it('flags a short receipt when less was accepted than ordered', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-short@example.com`, 'S6 Short')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '7' }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // Ordered 10, accepted 7, billed 10 — both short-received AND over-billed.
      // The money case wins the label, but all three numbers must be present.
      const flag = result.flags[0]
      expect(flag.flagType).toBe('invoice_exceeds_received')
      expect(Number(flag.poValue)).toBe(10)
      expect(Number(flag.receivedValue)).toBe(7)
      expect(Number(flag.invoiceValue)).toBe(10)
      expect(Number(flag.delta)).toBe(3)
    })

    it('flags a short receipt on its own when the invoice bills only what arrived', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-short-only@example.com`, 'S6 Short Only')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '7', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '7' }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags[0]
      expect(flag.flagType).toBe('short_receipt')
      expect(Number(flag.receivedValue)).toBe(7)
      expect(Number(flag.delta)).toBe(-3)
    })

    // THE headline test. A bare SUM() skips NULLs and returns a PARTIAL total,
    // so an unstated accepted quantity would look like a short delivery and
    // Optra would accuse a supplier who did nothing wrong (POLICY v1 #14, §1B).
    it('treats an unstated accepted quantity as not-stated, never as zero', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-null@example.com`, 'S6 Null')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: null }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.short_receipt).toBe(0)
      expect(result.counts.invoice_exceeds_received).toBe(0)
      expect(result.flags).toHaveLength(0)
    })

    // POLICY v1 #14: accepted quantity is summed across EVERY receipt linked to
    // the PO. Two part-deliveries that together fulfil the order are not a
    // short receipt.
    it('sums accepted quantity across every receipt linked to the purchase order', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-multi@example.com`, 'S6 Multi')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '6' }], 'GRN-1')
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '4' }], 'GRN-2')

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // Neither receipt alone covers the order, so an implementation that
      // compared receipts one at a time would flag a short delivery here.
      // Summing them first is what makes this correct — and asserting the run
      // is three_way is what stops this passing vacuously against a two-way
      // engine, which also returns no flags for a matching pair.
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(2)
      expect(result.flags).toHaveLength(0)
    })

    it('records three_way mode, the receipt line count, and which receipts it read', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-run@example.com`, 'S6 Run')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      const grn = await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '10' }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(1)

      const links = await db
        .select()
        .from(comparisonRunGoodsReceipts)
        .where(eq(comparisonRunGoodsReceipts.comparisonRunId, result.runId))
      expect(links.map((link) => link.goodsReceiptId)).toEqual([grn.id])
    })

    // §7.4: "Missing receiving document | two-way result clearly labeled; no
    // false three-way claim." The classification must also be untouched.
    it('stays two_way and classifies exactly as before when no receipt is linked', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-none@example.com`, 'S6 None')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('two_way')
      expect(run.goodsReceiptLineCount).toBeNull()
      expect(result.flags[0].flagType).toBe('quantity_mismatch')
      expect(result.flags[0].receivedValue).toBeNull()
    })

    // A receipt row that parsed to nothing is not receiving evidence.
    it('stays two_way when a linked receipt has no parsed lines', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-empty@example.com`, 'S6 Empty')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // A receipt row exists, so an implementation keying three_way off "is a
      // receipt linked?" rather than "did one parse?" would wrongly claim a
      // three-way match over no receiving evidence at all (§7.4 :1213).
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('two_way')
      expect(run.goodsReceiptLineCount).toBeNull()
      const links = await db
        .select()
        .from(comparisonRunGoodsReceipts)
        .where(eq(comparisonRunGoodsReceipts.comparisonRunId, result.runId))
      expect(links).toHaveLength(0)
    })

    // A receipt only becomes receiving evidence once it has finished parsing.
    // Mid-parse its line rows are whatever the previous attempt left behind,
    // and a re-parse replaces them wholesale — so reading them here computes a
    // three-way verdict from a document that is still changing underneath it.
    it('ignores a receipt that has not finished parsing, even when it has lines', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s8-processing@example.com`, 'S8 Processing GRN')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '7' }], 'GRN-1', 'processing')

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('two_way')
      expect(run.goodsReceiptLineCount).toBeNull()
      const links = await db
        .select()
        .from(comparisonRunGoodsReceipts)
        .where(eq(comparisonRunGoodsReceipts.comparisonRunId, result.runId))
      expect(links).toHaveLength(0)
    })

    // A failed re-parse marks the header `failed` but leaves the previous
    // attempt's line rows in place. Reading them accuses a supplier of
    // under-delivering on the authority of a document the system already knows
    // it could not read.
    it('ignores a receipt whose parse failed, rather than accusing on stale lines', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s8-failed@example.com`, 'S8 Failed GRN')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '7' }], 'GRN-1', 'failed')

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // Ordered 10, billed 10. The only thing that could make this a
      // discrepancy is the failed receipt's claim that 7 arrived.
      expect(result.flags).toHaveLength(0)
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('two_way')
    })
  })

  // POLICY v1 #4 and #6. Both types say the same thing: the documents disagree
  // about what is being measured, so the numbers are not comparable and NO
  // delta is computed. That absent delta is what distinguishes them from every
  // other flag type — it is the mechanical form of "a human has to look".
  describe('needs review — UOM and currency (S6)', () => {
    it('flags a UOM mismatch and computes no delta when the two sides state different units', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom@example.com`, 'S6 Uom')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'box' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'each' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.uom_mismatch).toBe(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('uom_mismatch')
      expect(flag.poValue).toBe('box')
      expect(flag.invoiceValue).toBe('each')
      // POLICY v1 #4: "no delta is computed". 10 boxes against 10 each is not a
      // difference of zero — it is not a difference at all.
      expect(flag.delta).toBeNull()
    })

    // The whole reason UOM outranks quantity: 10 boxes and 12 each is not a
    // shortfall of two, and reporting one would be a fabricated number.
    it('prefers the UOM mismatch over comparing quantities across different units', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom-qty@example.com`, 'S6 Uom Qty')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'box' }],
        [{ sku: 'A1', quantity: '12', unitPrice: '5.00', uom: 'each' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(1)
      expect(result.flags[0].flagType).toBe('uom_mismatch')
      expect(result.counts.quantity_mismatch).toBe(0)
      expect(result.flags[0].delta).toBeNull()
    })

    // The engine SUMS duplicate lines for one item. Summing 2 boxes and 1 each
    // produces "3" of nothing, so a side that contradicts itself is the same
    // problem as two sides contradicting each other.
    it('flags a UOM mismatch when one document’s own duplicate lines disagree on the unit', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom-self@example.com`, 'S6 Uom Self')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '2', unitPrice: '5.00', uom: 'box' },
          { sku: 'A1', quantity: '1', unitPrice: '5.00', uom: 'each' },
        ],
        [{ sku: 'A1', quantity: '3', unitPrice: '5.00', uom: 'box' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.uom_mismatch).toBe(1)
      expect(result.flags[0].delta).toBeNull()
    })

    // The receiving side is compared too, or S6's own arithmetic — accepted
    // against ordered — runs across units.
    it('flags a UOM mismatch when the receipt states a different unit from the order', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom-grn@example.com`, 'S6 Uom Grn')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'each' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'each' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '10', uom: 'box' }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.uom_mismatch).toBe(1)
      expect(result.flags[0].receivedValue).toBe('box')
      expect(result.flags[0].delta).toBeNull()
    })

    // Same invariant this whole slice is built on: absent is not a value. Most
    // lines in the system carry no unit at all, so reading "unstated" as
    // "different" would put every comparison into review.
    it('does not flag a UOM mismatch when only one side states a unit', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom-half@example.com`, 'S6 Uom Half')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'each' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.uom_mismatch).toBe(0)
      expect(result.flags).toHaveLength(0)
    })

    it('treats the same unit written differently as one unit', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-uom-case@example.com`, 'S6 Uom Case')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'EA' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: ' ea ' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.uom_mismatch).toBe(0)
      expect(result.flags).toHaveLength(0)
    })

    // POLICY v1 #6. A currency mismatch is a property of the two documents, not
    // of any one line, so it is one flag per run with no line references —
    // unlike every other flag type, which the engine derives per matched key.
    it('flags a currency mismatch once for the run, with no line references and no delta', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-cur@example.com`, 'S6 Currency')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        false,
        { po: 'USD', invoice: 'EUR' },
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.currency_mismatch).toBe(1)
      expect(result.flags).toHaveLength(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('currency_mismatch')
      expect(flag.poValue).toBe('USD')
      expect(flag.invoiceValue).toBe('EUR')
      expect(flag.delta).toBeNull()
      expect(flag.sku).toBeNull()
      expect(flag.poLineItemId).toBeNull()
      expect(flag.invoiceLineItemId).toBeNull()
    })

    it('records the currency flag against the run and counts it in the run’s flag count', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-cur-run@example.com`, 'S6 Currency Run')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
        false,
        { po: 'USD', invoice: 'EUR' },
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // The line-level evidence is not suppressed by the currency flag: the
      // quantity disagreement is true whatever the documents are billed in.
      expect(result.counts).toEqual({
        quantity_mismatch: 1,
        price_mismatch: 0,
        missing_on_invoice: 0,
        missing_on_po: 0,
        short_receipt: 0,
        invoice_exceeds_received: 0,
        uom_mismatch: 0,
        currency_mismatch: 1,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.flagCount).toBe(2)
      expect(result.flags.every((flag) => flag.comparisonRunId === result.runId)).toBe(true)
    })

    it('does not flag a currency mismatch when either document leaves the currency unstated', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-cur-half@example.com`, 'S6 Currency Half')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        false,
        { po: 'USD' },
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.currency_mismatch).toBe(0)
      expect(result.flags).toHaveLength(0)
    })

    // S3b uppercases on the way in, so this only bites pre-0025 rows — which is
    // exactly the population that cannot be fixed by validation.
    it('does not flag a currency mismatch when the two codes differ only in case', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-cur-case@example.com`, 'S6 Currency Case')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        false,
        { po: 'usd', invoice: 'USD' },
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.currency_mismatch).toBe(0)
      expect(result.flags).toHaveLength(0)
    })
  })

  // §7.4's outcome matrix, as one deliberately designed comparison rather than
  // POLICY v1 #5 / S9 commit 5. A second, independent question: was the price
  // we ORDERED at the one we had agreed? Never about the invoice — the
  // PO-vs-invoice verdict above is untouched.
  describe('contract price (S9)', () => {
    async function seedContracted(
      email: string,
      name: string,
      poItems: { sku: string; quantity: string; unitPrice: string; uom?: string }[],
      invItems: { sku: string; quantity: string; unitPrice: string; uom?: string }[],
      opts: { poCurrency?: string | null; orderedAt?: Date | null; withVendor?: boolean } = {},
    ) {
      const { workspace } = await seedWorkspace(email, name)
      const { po, invoice } = await seedReadyPoAndInvoice(workspace.id, poItems, invItems, false, {
        po: opts.poCurrency === undefined ? 'USD' : opts.poCurrency,
        invoice: opts.poCurrency === undefined ? 'USD' : opts.poCurrency,
      })
      const [vendor] = await db
        .insert(vendors)
        .values({ workspaceId: workspace.id, name: `${name} Vendor` })
        .returning()
      if (opts.withVendor !== false) {
        await db
          .update(purchaseOrders)
          .set({ vendorId: vendor.id, orderedAt: opts.orderedAt ?? null })
          .where(eq(purchaseOrders.id, po.id))
      }
      return { workspace, po, invoice, vendor }
    }

    async function seedTerm(
      workspaceId: string,
      vendorId: string,
      values: {
        sku: string
        unitPrice: string
        currency?: string
        uom?: string | null
        effectiveFrom: Date
        effectiveTo?: Date | null
      },
    ) {
      const [term] = await db
        .insert(vendorPriceTerms)
        .values({
          workspaceId,
          vendorId,
          sku: values.sku,
          skuKey: values.sku.toLowerCase(),
          uom: values.uom ?? null,
          unitPrice: values.unitPrice,
          currency: values.currency ?? 'USD',
          effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo ?? null,
        })
        .returning()
      return term
    }

    const contractFlags = (flags: { flagType: string; reason: string }[]) =>
      flags.filter((flag) => flag.flagType.startsWith('contract_price_'))

    const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

    it('says nothing when the order was placed at the agreed price', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-onprice@example.com`,
        'S9 On Price',
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      expect(contractFlags(result.flags)).toHaveLength(0)
    })

    it('flags an order placed above the agreed price, naming the term it used', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-variance@example.com`,
        'S9 Variance',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )
      const term = await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '5.00',
        effectiveFrom: LONG_AGO,
      })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      const flag = flags[0] as never as {
        flagType: string
        sku: string
        poUnitPrice: string
        contractUnitPrice: string
        contractTermId: string
        delta: string
        invoiceLineItemId: string | null
      }
      expect(flag.flagType).toBe('contract_price_variance')
      expect(flag.sku).toBe('A1')
      expect(Number(flag.poUnitPrice)).toBe(6)
      expect(Number(flag.contractUnitPrice)).toBe(5)
      expect(flag.contractTermId).toBe(term.id)
      // Ordered minus agreed: positive means we paid over the contract.
      expect(Number(flag.delta)).toBe(1)
      // No invoice is involved in a contract finding.
      expect(flag.invoiceLineItemId).toBeNull()
    })

    // The case an engine-row-driven check would miss entirely: the invoice
    // matches the order perfectly, so the engine emits no row for this line.
    it('flags an off-contract order even when the invoice matches it exactly', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-silentline@example.com`,
        'S9 Silent Line',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      // The only engine verdict for this line would have been 'match'.
      expect(result.flags.filter((f) => !f.flagType.startsWith('contract_price_'))).toHaveLength(0)
      expect(contractFlags(result.flags)).toHaveLength(1)
    })

    it('lets a line carry both a billing dispute and a contract finding', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-both@example.com`,
        'S9 Both',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '7.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      // Two rows for one line, deliberately: the vendor over-billed AND we
      // ordered off contract. Different counterparties, different remedies.
      expect(result.flags).toHaveLength(2)
      expect(result.counts.price_mismatch).toBe(1)
      expect(result.counts.contract_price_variance).toBe(1)
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
      expect(total).toBe(result.flags.length)
    })

    // §7.4: "Contract price expired | price applicability exception, not
    // silent match."
    it('refuses to judge an order whose only contract had already expired', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-expired@example.com`,
        'S9 Expired',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        { orderedAt: new Date('2026-08-14T00:00:00.000Z') },
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '5.00',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-06-30T00:00:00.000Z'),
      })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      expect(flags[0].flagType).toBe('contract_price_unavailable')
      // The reason names the window that did exist, so a reviewer can see
      // whether the order or the contract is the thing out of date.
      expect(flags[0].reason).toContain('2026')
      expect((flags[0] as never as { contractUnitPrice: string | null }).contractUnitPrice).toBeNull()
    })

    it('stays silent about an item the vendor never agreed a price for', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-noterm@example.com`,
        'S9 No Term',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'OTHER', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      expect(contractFlags(result.flags)).toHaveLength(0)
    })

    it('will not choose between two contracts that both cover the order', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-ambiguous@example.com`,
        'S9 Ambiguous',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '7.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      expect(flags[0].flagType).toBe('contract_price_unavailable')
      // Neither price was picked — not the cheaper, not the newer.
      expect((flags[0] as never as { contractUnitPrice: string | null }).contractUnitPrice).toBeNull()
    })

    it('will not compare an agreed price stated in another currency', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-contract-currency@example.com`,
        'S9 Contract Currency',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '5.00',
        currency: 'EUR',
        effectiveFrom: LONG_AGO,
      })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      expect(flags[0].flagType).toBe('contract_price_unavailable')
      expect(flags[0].reason).toContain('EUR')
    })

    // POLICY v1 #4: units are captured, never converted. A price per case and
    // a price per each are not the same number.
    it('will not compare an agreed price stated per a different unit', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-contract-uom@example.com`,
        'S9 Contract Uom',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00', uom: 'each' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00', uom: 'each' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '60.00',
        uom: 'case',
        effectiveFrom: LONG_AGO,
      })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      expect(flags[0].flagType).toBe('contract_price_unavailable')
    })

    it('applies a term that states no unit, the same way an unstated unit is not a mismatch', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-uomnull@example.com`,
        'S9 Contract Uom Null',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00', uom: 'each' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00', uom: 'each' }],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const flags = contractFlags(result.flags)
      expect(flags).toHaveLength(1)
      expect(flags[0].flagType).toBe('contract_price_variance')
    })

    it('says nothing at all about a purchase order with no vendor', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-novendor@example.com`,
        'S9 No Vendor',
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
        { withVendor: false },
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      expect(contractFlags(result.flags)).toHaveLength(0)
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      // Null, not zero: zero would claim we looked and found none.
      expect(run.contractTermCount).toBeNull()
    })

    it('records how many agreed prices the run had to judge against', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-count@example.com`,
        'S9 Count',
        [
          { sku: 'A1', quantity: '10', unitPrice: '6.00' },
          { sku: 'B2', quantity: '4', unitPrice: '3.00' },
        ],
        [
          { sku: 'A1', quantity: '10', unitPrice: '6.00' },
          { sku: 'B2', quantity: '4', unitPrice: '3.00' },
        ],
      )
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'A1', unitPrice: '5.00', effectiveFrom: LONG_AGO })
      await seedTerm(ctx.workspace.id, ctx.vendor.id, { sku: 'B2', unitPrice: '3.00', effectiveFrom: LONG_AGO })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.contractTermCount).toBe(2)
      expect(run.strategyVersion).toBe(COMPARISON_STRATEGY_VERSION)
      expect(COMPARISON_STRATEGY_VERSION).toBe(3)
    })

    // The whole reason commit 4 exists: applicability is asked of the date the
    // order was PLACED, not the date the file arrived.
    it('judges the order against the contract live when it was placed, not when it was uploaded', async () => {
      const ctx = await seedContracted(
        `${prefix}s9-ordered@example.com`,
        'S9 Ordered At',
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        { orderedAt: new Date('2026-02-01T00:00:00.000Z') },
      )
      // What was agreed in February — and what the order was placed at.
      await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '5.00',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-06-01T00:00:00.000Z'),
      })
      // What is agreed now, and would have flagged a variance that never was.
      await seedTerm(ctx.workspace.id, ctx.vendor.id, {
        sku: 'A1',
        unitPrice: '9.00',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      })

      const result = await service.compare(ctx.workspace.id, ctx.po.id, ctx.invoice.id)

      expect(contractFlags(result.flags)).toHaveLength(0)
    })
  })

  // POLICY v1 #5 / S9 commit 1. The CASE ladder returns its first match, so a
  // line whose quantity AND unit price both differ is labelled by the quantity
  // and the price difference was recorded nowhere. The label still belongs to
  // the quantity — what changes is that the price no longer disappears with it.
  describe('unit price carried past the branch that masked it (S9)', () => {
    it('keeps the quantity label but records both unit prices when the price also differs', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-masked@example.com`, 'S9 Masked Price')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '25.00' }],
        [{ sku: 'A1', quantity: '12', unitPrice: '27.50' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      // Exactly one flag: the line is not split into two rows.
      expect(result.flags).toHaveLength(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('quantity_mismatch')
      // The nothing-moved assertions — label and delta are the quantity's.
      expect(Number(flag.poValue)).toBe(10)
      expect(Number(flag.invoiceValue)).toBe(12)
      expect(Number(flag.delta)).toBe(2)
      // …and the price the branch used to swallow.
      expect(Number(flag.poUnitPrice)).toBe(25)
      expect(Number(flag.invoiceUnitPrice)).toBe(27.5)
      expect(flag.reason).toContain('25')
      expect(flag.reason).toContain('27.5')
    })

    it('leaves the price columns alone when only the quantity differs', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-qtyonly@example.com`, 'S9 Quantity Only')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags[0]
      expect(flag.flagType).toBe('quantity_mismatch')
      // Both sides agree on price, so both columns state it — and the reason
      // gains no price clause, because there is no disagreement to report.
      expect(Number(flag.poUnitPrice)).toBe(5)
      expect(Number(flag.invoiceUnitPrice)).toBe(5)
      expect(flag.reason).toBe('Quantity mismatch for A1: PO=10 Invoice=8')
    })

    it('states the prices on a price mismatch too, so one column can be read across every type', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-price@example.com`, 'S9 Price Flag')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '6.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags[0]
      expect(flag.flagType).toBe('price_mismatch')
      // Deliberately the same numbers as poValue/invoiceValue. A numeric column
      // populated on one flag type only cannot be aggregated.
      expect(Number(flag.poUnitPrice)).toBe(5)
      expect(Number(flag.invoiceUnitPrice)).toBe(6)
      expect(flag.poUnitPrice).toBe(flag.poValue)
      expect(flag.invoiceUnitPrice).toBe(flag.invoiceValue)
    })

    // POLICY v1 #4 must not move: units are captured, never converted, so a UOM
    // flag still computes no delta. The prices ride along as evidence only.
    it('carries the prices on a UOM mismatch without computing a delta', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-uom@example.com`, 'S9 Uom Price')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00', uom: 'each' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '60.00', uom: 'box' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags[0]
      expect(flag.flagType).toBe('uom_mismatch')
      expect(flag.delta).toBeNull()
      expect(Number(flag.poUnitPrice)).toBe(5)
      expect(Number(flag.invoiceUnitPrice)).toBe(60)
    })

    // Null means "we do not know", never a number we picked. singlePrice()
    // already refuses a side whose own duplicate lines disagree.
    it('leaves a side null when that document states more than one price for the item', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-mixed@example.com`, 'S9 Mixed Price')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '4', unitPrice: '5.00' },
          { sku: 'A1', quantity: '6', unitPrice: '7.00' },
        ],
        [{ sku: 'A1', quantity: '12', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags[0]
      expect(flag.poUnitPrice).toBeNull()
      expect(Number(flag.invoiceUnitPrice)).toBe(5)
    })

    it('states the present side only when the item is missing from the other document', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-missing@example.com`, 'S9 Missing Side')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'PO-ONLY', quantity: '3', unitPrice: '9.00' }],
        [{ sku: 'INV-ONLY', quantity: '2', unitPrice: '4.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const missingOnInvoice = result.flags.find((f) => f.flagType === 'missing_on_invoice')!
      expect(Number(missingOnInvoice.poUnitPrice)).toBe(9)
      expect(missingOnInvoice.invoiceUnitPrice).toBeNull()

      const missingOnPo = result.flags.find((f) => f.flagType === 'missing_on_po')!
      expect(missingOnPo.poUnitPrice).toBeNull()
      expect(Number(missingOnPo.invoiceUnitPrice)).toBe(4)
    })

    // The header-level flag has no line behind it, so it has no price either.
    it('leaves both columns null on the currency flag', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-currency@example.com`, 'S9 Currency Price')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        false,
        { po: 'USD', invoice: 'EUR' },
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const flag = result.flags.find((f) => f.flagType === 'currency_mismatch')!
      expect(flag.poUnitPrice).toBeNull()
      expect(flag.invoiceUnitPrice).toBeNull()
    })

    it('records the engine version that produced the run, so S8 recompares after this change', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s9-version@example.com`, 'S9 Version')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      // The literal is pinned once, in the contract block that last moved it.
      expect(run.strategyVersion).toBe(COMPARISON_STRATEGY_VERSION)
    })
  })

  // a sample of whatever the demo seed happens to produce. Every row below is
  // one line item chosen to land on exactly one classification, so a change
  // that moves a boundary shows up here as a named row rather than a count.
  describe('golden three-way fixture (§7.4)', () => {
    it('classifies one deliberately built three-way comparison, row by row', async () => {
      const { workspace } = await seedWorkspace(`${prefix}s6-golden@example.com`, 'S6 Golden')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'MATCH-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'SHORT-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'OVER-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'QTY-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'PRICE-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'UOM-1', quantity: '10', unitPrice: '5.00', uom: 'box' },
          { sku: 'POONLY-1', quantity: '5', unitPrice: '1.00', uom: 'each' },
        ],
        [
          { sku: 'MATCH-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'SHORT-1', quantity: '8', unitPrice: '5.00', uom: 'each' },
          { sku: 'OVER-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'QTY-1', quantity: '12', unitPrice: '5.00', uom: 'each' },
          { sku: 'PRICE-1', quantity: '10', unitPrice: '7.00', uom: 'each' },
          { sku: 'UOM-1', quantity: '10', unitPrice: '5.00', uom: 'each' },
          { sku: 'INVONLY-1', quantity: '3', unitPrice: '1.00', uom: 'each' },
        ],
        true,
        { po: 'USD', invoice: 'USD' },
      )
      // Two receipts, so "partial receipt across multiple records" is exercised
      // by MATCH-1 rather than asserted in the abstract.
      await seedGoodsReceipt(
        workspace.id,
        po.id,
        [
          { sku: 'MATCH-1', quantityAccepted: '6', uom: 'each' },
          { sku: 'SHORT-1', quantityAccepted: '8', uom: 'each' },
          { sku: 'OVER-1', quantityAccepted: '7', uom: 'each' },
          // Received, but the source never said how many were accepted.
          { sku: 'QTY-1', quantityAccepted: null, uom: 'each' },
          { sku: 'PRICE-1', quantityAccepted: '10', uom: 'each' },
          { sku: 'UOM-1', quantityAccepted: '10', uom: 'box' },
          { sku: 'POONLY-1', quantityAccepted: '5', uom: 'each' },
        ],
        'GRN-1',
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'MATCH-1', quantityAccepted: '4', uom: 'each' }], 'GRN-2')

      const result = await service.compare(workspace.id, po.id, invoice.id)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('three_way')

      const bySku = new Map(result.flags.map((flag) => [flag.sku, flag]))

      // Exact SKU, same quantity and price, and two part-deliveries summing to
      // the order → matched, no exception.
      expect(bySku.has('MATCH-1')).toBe(false)
      // Quantity short receipt → receiving exception with a delta.
      expect(bySku.get('SHORT-1').flagType).toBe('short_receipt')
      expect(Number(bySku.get('SHORT-1').delta)).toBe(-2)
      // Invoice quantity exceeds received → invoice/receiving exception.
      expect(bySku.get('OVER-1').flagType).toBe('invoice_exceeds_received')
      expect(Number(bySku.get('OVER-1').delta)).toBe(3)
      // Accepted quantity unstated, so the receiving branches must not fire and
      // the PO/invoice disagreement is what is left to report.
      expect(bySku.get('QTY-1').flagType).toBe('quantity_mismatch')
      expect(Number(bySku.get('QTY-1').delta)).toBe(2)
      // Unit-price variance against the authoritative PO price (POLICY v1 #5).
      expect(bySku.get('PRICE-1').flagType).toBe('price_mismatch')
      expect(Number(bySku.get('PRICE-1').delta)).toBe(2)
      // UOM unknown / not convertible → needs review, no guessed conversion.
      expect(bySku.get('UOM-1').flagType).toBe('uom_mismatch')
      expect(bySku.get('UOM-1').delta).toBeNull()
      expect(bySku.get('POONLY-1').flagType).toBe('missing_on_invoice')
      expect(bySku.get('INVONLY-1').flagType).toBe('missing_on_po')

      expect(result.counts).toEqual({
        quantity_mismatch: 1,
        price_mismatch: 1,
        missing_on_invoice: 1,
        missing_on_po: 1,
        short_receipt: 1,
        invoice_exceeds_received: 1,
        uom_mismatch: 1,
        currency_mismatch: 0,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
    })
  })

  // S3b / POLICY v1 #2. Once an invoice records which PO it answers, comparing
  // it against a different PO is a mistake worth refusing — otherwise the link
  // is decoration that can silently contradict what was actually compared.
  // S7. The list is the product's main surface and it was unbounded: every
  // flag in the workspace in one response, with the six stat-card counts
  // computed in the browser from whatever happened to arrive.
  describe('listFlags pagination (S7)', () => {
    // Four flags from ONE comparison — the case that breaks a naive
    // implementation. compare() inserts every flag of a run inside a single
    // transaction, so `created_at` is `now()` evaluated once and all four rows
    // share it to the microsecond.
    async function seedFourFlags(email: string, name: string) {
      const { workspace } = await seedWorkspace(email, name)
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
      expect(result.flags).toHaveLength(4)
      return { workspace, po, invoice }
    }

    it('returns one page at a time and reports the size of the whole result', async () => {
      const { workspace } = await seedFourFlags(`${prefix}s7-page@example.com`, 'S7 Page')

      const page = await service.listFlags(workspace.id, { page: '1', pageSize: '2' })

      expect(page.items).toHaveLength(2)
      expect(page.page).toBe(1)
      expect(page.pageSize).toBe(2)
      expect(page.total).toBe(4)
      expect(page.totalPages).toBe(2)
    })

    // THE test for this commit. Ordering on `created_at` alone is not a total
    // order when four rows share the timestamp, so Postgres may return them in
    // a different order for each OFFSET — silently repeating some flags on
    // page 2 and dropping others entirely. A reviewer working the queue would
    // never see the dropped ones.
    it('never repeats or drops a flag across pages when one run wrote them all at once', async () => {
      const { workspace } = await seedFourFlags(`${prefix}s7-stable@example.com`, 'S7 Stable')

      const first = await service.listFlags(workspace.id, { page: '1', pageSize: '2' })
      const second = await service.listFlags(workspace.id, { page: '2', pageSize: '2' })

      expect(second.items).toHaveLength(2)
      const seen = [...first.items, ...second.items].map((flag) => flag.id)
      expect(new Set(seen).size).toBe(4)
    })

    it('defaults to a page of twenty and clamps an oversized page size', async () => {
      const { workspace } = await seedFourFlags(`${prefix}s7-clamp@example.com`, 'S7 Clamp')

      expect((await service.listFlags(workspace.id, {})).pageSize).toBe(20)
      expect((await service.listFlags(workspace.id, { pageSize: '5000' })).pageSize).toBe(100)
    })

    // The stat cards used to be computed in the browser from the array it held.
    // Paginated, that reports "1 price mismatch" on a page showing one of
    // forty. The counts have to describe the filtered set, not the page.
    it('counts the whole filtered set, not the page, and always carries all ten types', async () => {
      const { workspace } = await seedFourFlags(`${prefix}s7-counts@example.com`, 'S7 Counts')

      const page = await service.listFlags(workspace.id, { page: '1', pageSize: '1' })

      expect(page.items).toHaveLength(1)
      expect(page.counts).toEqual({
        quantity_mismatch: 1,
        price_mismatch: 1,
        missing_on_invoice: 1,
        missing_on_po: 1,
        short_receipt: 0,
        invoice_exceeds_received: 0,
        uom_mismatch: 0,
        currency_mismatch: 0,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
      expect(Object.values(page.counts).reduce((a, b) => a + b, 0)).toBe(page.total)
    })

    it('narrows the counts by the same filters that narrow the list', async () => {
      const { workspace, user } = await (async () => {
        const seeded = await seedFourFlags(`${prefix}s7-count-filter@example.com`, 'S7 Count Filter')
        const [owner] = await db
          .select()
          .from(users)
          .where(like(users.email, `${prefix}s7-count-filter%`))
        return { ...seeded, user: owner }
      })()

      const open = await service.listFlags(workspace.id, { status: 'open' })
      expect(open.total).toBe(4)

      await service.dismissFlag(workspace.id, open.items[0].id, user.id)
      const stillOpen = await service.listFlags(workspace.id, { status: 'open' })

      expect(stillOpen.total).toBe(3)
      expect(Object.values(stillOpen.counts).reduce((a, b) => a + b, 0)).toBe(3)
    })
  })

  // S7. Runs were written from S1 onward and never readable: `?runId=` could
  // read one run's flags, but nothing in the API told you a run id existed.
  describe('listRuns (S7)', () => {
    it('lists a workspace’s runs newest first, in a page', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}s7-runs@example.com`, 'S7 Runs')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      const first = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const second = await service.compare(workspace.id, po.id, invoice.id, user.id)

      const runs = await service.listRuns(workspace.id, {})

      expect(runs.total).toBe(2)
      expect(runs.items.map((run) => run.id)).toEqual([second.runId, first.runId])
      expect(runs.items[0].status).toBe('succeeded')
      expect(runs.items[0].flagCount).toBe(1)
    })

    // The reviewer asks "what did the last comparison of THIS pair say?", so
    // the pair filter is the point of the endpoint, not a convenience.
    it('filters to one purchase order and invoice pair', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}s7-runs-pair@example.com`, 'S7 Runs Pair')
      const pairA = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      const pairB = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'B1', quantity: '4', unitPrice: '2.00' }],
        [{ sku: 'B1', quantity: '4', unitPrice: '3.00' }],
      )
      await service.compare(workspace.id, pairA.po.id, pairA.invoice.id, user.id)
      const onB = await service.compare(workspace.id, pairB.po.id, pairB.invoice.id, user.id)

      const runs = await service.listRuns(workspace.id, {
        purchaseOrderId: pairB.po.id,
        invoiceId: pairB.invoice.id,
      })

      expect(runs.items.map((run) => run.id)).toEqual([onB.runId])
    })

    // A failed run is the one a reviewer most needs to see. `lastError` is
    // already client-safe — S0a made sure the engine's own text, which can
    // quote cell values, is never stored.
    it('returns a failed run with its client-safe reference', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}s7-runs-failed@example.com`, 'S7 Runs Failed')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      jest
        .spyOn(DuckDbQueryService.prototype, 'runReadOnlyMultiTableQuery')
        .mockRejectedValueOnce(new SqlExecutionError('Binder Error: quoting a cell value'))
      await expect(service.compare(workspace.id, po.id, invoice.id, user.id)).rejects.toThrow()

      const runs = await service.listRuns(workspace.id, { status: 'failed' })

      expect(runs.items).toHaveLength(1)
      expect(runs.items[0].lastError).toMatch(/^Comparison engine failed\. Reference: [0-9a-f]{8}$/)
      expect(runs.items[0].lastError).not.toContain('Binder Error')
    })

    it('names who ran it, and tolerates a run nobody is attached to', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}s7-runs-actor@example.com`, 'S7 Runs Actor')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      await service.compare(workspace.id, po.id, invoice.id, user.id)
      // `initiatedBy` is nullable and ON DELETE set null, so the join must be
      // a LEFT join or an orphaned run would vanish from its own history.
      await service.compare(workspace.id, po.id, invoice.id)

      const runs = await service.listRuns(workspace.id, {})

      expect(runs.items).toHaveLength(2)
      expect(runs.items[0].initiatedByEmail).toBeNull()
      expect(runs.items[1].initiatedByEmail).toBe(`${prefix}s7-runs-actor@example.com`)
    })

    it('never shows another workspace’s runs', async () => {
      const { workspace: mine } = await seedWorkspace(`${prefix}s7-runs-mine@example.com`, 'S7 Runs Mine')
      const { workspace: other, user: otherUser } = await seedWorkspace(
        `${prefix}s7-runs-other@example.com`,
        'S7 Runs Other',
      )
      const { po, invoice } = await seedReadyPoAndInvoice(
        other.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      await service.compare(other.id, po.id, invoice.id, otherUser.id)

      expect((await service.listRuns(mine.id, {})).items).toHaveLength(0)
    })
  })

  // S7. The decision list carried an actor uuid and nothing a human could
  // read. `users` has only an email, and members already see each other's
  // emails through the members list, so this exposes nothing new.
  describe('decision actors (S7)', () => {
    it('names the actor on each decision, and tolerates a deleted one', async () => {
      const { workspace, user } = await seedWorkspace(`${prefix}s7-actor@example.com`, 'S7 Actor')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )
      const run = await service.compare(workspace.id, po.id, invoice.id, user.id)
      const flagId = run.flags[0].id
      await service.recordDecision(workspace.id, flagId, user.id, {
        outcome: 'approved_exception',
        note: 'Agreed with the vendor by phone.',
      })

      const decisions = await service.listDecisions(workspace.id, flagId)

      expect(decisions).toHaveLength(1)
      expect(decisions[0].actorEmail).toBe(`${prefix}s7-actor@example.com`)
      expect(decisions[0].actorRole).toBe('owner')
      expect(decisions[0].note).toBe('Agreed with the vendor by phone.')
    })
  })

  describe('purchase order link enforcement (S3b)', () => {
    const oneLine = [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }]

    it('refuses to compare an invoice against a purchase order it is not linked to', async () => {
      const { workspace } = await seedWorkspace(`${prefix}link-mismatch@example.com`, 'Link Mismatch')
      const { invoice } = await seedReadyPoAndInvoice(workspace.id, oneLine, oneLine, true)
      // A second, unrelated PO in the same workspace — passes the workspace
      // check, so only the link guard can catch it.
      const { po: otherPo } = await seedReadyPoAndInvoice(workspace.id, oneLine, oneLine)

      await expect(service.compare(workspace.id, otherPo.id, invoice.id)).rejects.toThrow(
        'Invoice is linked to a different purchase order',
      )

      // Refused before any run row is written: a rejected request is a mistake,
      // not evidence of an attempted comparison.
      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.invoiceId, invoice.id))
      expect(runs).toHaveLength(0)
    })

    it('compares an invoice against the purchase order it is linked to', async () => {
      const { workspace } = await seedWorkspace(`${prefix}link-match@example.com`, 'Link Match')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
        true,
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.quantity_mismatch).toBe(1)
    })

    // The legacy path. Every invoice uploaded before migration 0025 has a null
    // link, and those must keep comparing exactly as they did — this is what
    // makes the guard safe to ship without a backfill.
    it('compares an invoice that carries no link at all', async () => {
      const { workspace } = await seedWorkspace(`${prefix}link-null@example.com`, 'Link Null')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.counts.quantity_mismatch).toBe(1)
    })
  })
})
