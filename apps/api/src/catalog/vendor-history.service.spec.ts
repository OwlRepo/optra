import { eq, like } from 'drizzle-orm'
import {
  comparisonRuns,
  db,
  discrepancyFlags,
  invoices,
  poLineItems,
  pool,
  purchaseOrders,
  users,
  vendorPriceTerms,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { VendorHistoryService } from './vendor-history.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const m of memberships) {
      await db.delete(discrepancyFlags).where(eq(discrepancyFlags.workspaceId, m.workspaceId))
      await db.delete(comparisonRuns).where(eq(comparisonRuns.workspaceId, m.workspaceId))
      await db.delete(poLineItems).where(eq(poLineItems.workspaceId, m.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, m.workspaceId))
      await db.delete(vendorPriceTerms).where(eq(vendorPriceTerms.workspaceId, m.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, m.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, m.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, m.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, m.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

describe('VendorHistoryService', () => {
  let service: VendorHistoryService
  const prefix = `vendor-history-spec-${Date.now()}-`

  beforeEach(() => {
    service = new VendorHistoryService()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedVendor(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    const [vendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: `${name} Ltd` }).returning()
    return { user, workspace, vendor }
  }

  async function seedOrder(
    workspaceId: string,
    vendorId: string,
    poNumber: string,
    orderedAt: Date,
    lines: { sku: string; quantity: string; unitPrice: string; uom?: string }[],
  ) {
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        workspaceId,
        vendorId,
        name: `${poNumber}.csv`,
        poNumber,
        currency: 'USD',
        status: 'done',
        orderedAt,
        rowCount: lines.length,
      })
      .returning()
    await db.insert(poLineItems).values(
      lines.map((line, index) => ({
        workspaceId,
        purchaseOrderId: po.id,
        lineNumber: index + 1,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        uom: line.uom ?? null,
      })),
    )
    return po
  }

  describe('get', () => {
    it('returns the vendor, so a page does not have to scan the whole list', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}get@example.com`, 'Get')

      const found = await service.get(workspace.id, vendor.id)

      expect(found.id).toBe(vendor.id)
      expect(found.name).toBe('Get Ltd')
    })

    it('refuses a vendor from another workspace', async () => {
      const mine = await seedVendor(`${prefix}get-mine@example.com`, 'Get Mine')
      const theirs = await seedVendor(`${prefix}get-theirs@example.com`, 'Get Theirs')

      await expect(service.get(mine.workspace.id, theirs.vendor.id)).rejects.toThrow()
    })
  })

  describe('priceHistory', () => {
    it('lists what was paid per item over time, newest order first', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}hist@example.com`, 'Hist')
      await seedOrder(workspace.id, vendor.id, 'PO-1', new Date('2026-01-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '10', unitPrice: '5.00' },
      ])
      await seedOrder(workspace.id, vendor.id, 'PO-2', new Date('2026-06-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '10', unitPrice: '6.00' },
      ])

      const page = await service.priceHistory(workspace.id, vendor.id, {})

      expect(page.total).toBe(2)
      expect(page.items[0].poNumber).toBe('PO-2')
      expect(Number(page.items[0].unitPrice)).toBe(6)
      expect(Number(page.items[1].unitPrice)).toBe(5)
      // The envelope carries which items this vendor has ever been bought
      // from, so a filter can be offered without a second request.
      expect(page.skus).toEqual(['A1'])
    })

    it('names the agreed price live when each order was placed', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}hist-term@example.com`, 'Hist Term')
      await db.insert(vendorPriceTerms).values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        sku: 'A1',
        skuKey: 'a1',
        unitPrice: '5.00',
        currency: 'USD',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-04-01T00:00:00.000Z'),
      })
      await db.insert(vendorPriceTerms).values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        sku: 'A1',
        skuKey: 'a1',
        unitPrice: '5.50',
        currency: 'USD',
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      })
      await seedOrder(workspace.id, vendor.id, 'PO-EARLY', new Date('2026-02-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '1', unitPrice: '5.00' },
      ])
      await seedOrder(workspace.id, vendor.id, 'PO-LATE', new Date('2026-09-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '1', unitPrice: '9.00' },
      ])

      const page = await service.priceHistory(workspace.id, vendor.id, {})

      const late = page.items.find((row) => row.poNumber === 'PO-LATE')!
      const early = page.items.find((row) => row.poNumber === 'PO-EARLY')!
      // Each order is measured against the contract that was live for IT, not
      // against whichever one happens to be open today.
      expect(Number(late.contractUnitPrice)).toBe(5.5)
      expect(Number(early.contractUnitPrice)).toBe(5)
    })

    it('narrows to one item when asked', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}hist-sku@example.com`, 'Hist Sku')
      await seedOrder(workspace.id, vendor.id, 'PO-1', new Date('2026-01-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '1', unitPrice: '5.00' },
        { sku: 'B2', quantity: '1', unitPrice: '3.00' },
      ])

      const page = await service.priceHistory(workspace.id, vendor.id, { sku: 'a1' })

      expect(page.total).toBe(1)
      expect(page.items[0].sku).toBe('A1')
      // The SKU list describes the vendor, not the filter — otherwise the
      // filter could never be changed without clearing it first.
      expect(page.skus).toEqual(['A1', 'B2'])
    })

    it('pages without repeating or dropping a row', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}hist-page@example.com`, 'Hist Page')
      const lines = Array.from({ length: 5 }, (_, i) => ({
        sku: `S${i}`,
        quantity: '1',
        unitPrice: `${i + 1}.00`,
      }))
      await seedOrder(workspace.id, vendor.id, 'PO-1', new Date('2026-01-01T00:00:00.000Z'), lines)

      const first = await service.priceHistory(workspace.id, vendor.id, { page: '1', pageSize: '2' })
      const second = await service.priceHistory(workspace.id, vendor.id, { page: '2', pageSize: '2' })

      expect(first.total).toBe(5)
      expect(first.totalPages).toBe(3)
      const ids = [...first.items, ...second.items].map((row) => row.poLineItemId)
      expect(new Set(ids).size).toBe(4)
    })

    it('returns an empty page for a vendor nothing was ever bought from', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}hist-empty@example.com`, 'Hist Empty')

      const page = await service.priceHistory(workspace.id, vendor.id, {})

      // Missing data is distinct from good performance — an empty page, not an
      // error and not a zero that reads like a result.
      expect(page.items).toEqual([])
      expect(page.total).toBe(0)
      expect(page.skus).toEqual([])
    })

    it('never shows another workspace’s orders', async () => {
      const mine = await seedVendor(`${prefix}hist-iso-mine@example.com`, 'Hist Iso Mine')
      const theirs = await seedVendor(`${prefix}hist-iso-theirs@example.com`, 'Hist Iso Theirs')
      await seedOrder(theirs.workspace.id, theirs.vendor.id, 'PO-T', new Date('2026-01-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '1', unitPrice: '5.00' },
      ])

      await expect(service.priceHistory(mine.workspace.id, theirs.vendor.id, {})).rejects.toThrow()
    })
  })

  describe('exceptionSummary', () => {
    it('counts this vendor’s exceptions by type, and says how many orders they came from', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}sum@example.com`, 'Sum')
      const po = await seedOrder(workspace.id, vendor.id, 'PO-1', new Date('2026-01-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '10', unitPrice: '5.00' },
      ])
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId: workspace.id, name: 'inv.csv', status: 'done', purchaseOrderId: po.id })
        .returning()
      await db.insert(discrepancyFlags).values([
        {
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          flagType: 'quantity_mismatch',
          reason: 'x',
        },
        {
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          flagType: 'quantity_mismatch',
          reason: 'y',
        },
        {
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          flagType: 'contract_price_variance',
          reason: 'z',
          status: 'dismissed',
        },
      ])

      const summary = await service.exceptionSummary(workspace.id, vendor.id)

      expect(summary.counts.quantity_mismatch).toBe(2)
      expect(summary.counts.contract_price_variance).toBe(1)
      // Zero-filled, so a caller can render every type without guarding.
      expect(summary.counts.short_receipt).toBe(0)
      expect(summary.openTotal).toBe(2)
      expect(summary.purchaseOrderCount).toBe(1)
    })

    it('reports a clean vendor as zero rather than as nothing', async () => {
      const { workspace, vendor } = await seedVendor(`${prefix}sum-clean@example.com`, 'Sum Clean')
      await seedOrder(workspace.id, vendor.id, 'PO-1', new Date('2026-01-01T00:00:00.000Z'), [
        { sku: 'A1', quantity: '1', unitPrice: '5.00' },
      ])

      const summary = await service.exceptionSummary(workspace.id, vendor.id)

      expect(summary.openTotal).toBe(0)
      expect(summary.purchaseOrderCount).toBe(1)
      expect(Object.values(summary.counts).every((n) => n === 0)).toBe(true)
    })
  })
})
