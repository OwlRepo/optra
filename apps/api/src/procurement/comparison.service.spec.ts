import { eq, like } from 'drizzle-orm'
import {
  db,
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
import { DuckDbQueryService } from '../structured-query/duckdb-query.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(discrepancyFlags).where(eq(discrepancyFlags.workspaceId, membership.workspaceId))
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

  it('re-comparing the same PO/invoice pair replaces prior flags rather than duplicating them', async () => {
    const { workspace } = await seedWorkspace(`${prefix}rerun@example.com`, 'Rerun')
    const { po, invoice } = await seedReadyPoAndInvoice(
      workspace.id,
      [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      [{ sku: 'A1', quantity: '8', unitPrice: '5.00' }],
    )

    await service.compare(workspace.id, po.id, invoice.id)
    await service.compare(workspace.id, po.id, invoice.id)

    const flags = await db.select().from(discrepancyFlags).where(eq(discrepancyFlags.purchaseOrderId, po.id))
    expect(flags).toHaveLength(1)
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
