import { BadRequestException, NotFoundException } from '@nestjs/common'
import sharp from 'sharp'
import { eq, like } from 'drizzle-orm'
import { StorageObjectNotFoundError } from '../storage/storage.errors'
import {
  comparisonRunGoodsReceipts,
  comparisonRuns,
  db,
  goodsReceipts,
  invoices,
  pool,
  purchaseOrders,
  users,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import {
  ProcurementDocumentsService,
  type ProcurementGrnHeader,
  type ProcurementInvoiceHeader,
  type ProcurementPoHeader,
} from './procurement-documents.service'
import { StorageService } from '../storage/storage.service'
import { ProcurementParseService } from './procurement-parse.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(comparisonRuns).where(eq(comparisonRuns.workspaceId, membership.workspaceId))
      // invoices before purchase_orders: the S3b link is ON DELETE set null, so
      // either order is legal, but deleting the child first keeps the intent
      // obvious rather than relying on the constraint to tidy up.
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, membership.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
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

async function seedVendor(workspaceId: string, name = 'Nordwerk Interiors') {
  const [vendor] = await db.insert(vendors).values({ workspaceId, name }).returning()
  return vendor
}

// S3b makes every header field required at upload (POLICY v1 #2, #3), so each
// upload call now needs a real vendor / purchase order to point at. These build
// the minimum valid header so the existing tests stay about what they were
// testing — sourceKind, storage cleanup, queue failure — and not about linkage.
async function poHeader(workspaceId: string, overrides: Partial<ProcurementPoHeader> = {}) {
  const vendor = await seedVendor(workspaceId)
  return { vendorId: vendor.id, poNumber: 'PO-2026-1180', currency: 'USD', ...overrides }
}

async function grnHeader(workspaceId: string, overrides: Partial<ProcurementGrnHeader> = {}) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ workspaceId, name: 'linked-po.csv', status: 'done' })
    .returning()
  return { purchaseOrderId: po.id, grnNumber: 'GRN-9001', ...overrides }
}

async function invoiceHeader(workspaceId: string, overrides: Partial<ProcurementInvoiceHeader> = {}) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ workspaceId, name: 'linked-po.csv', status: 'done' })
    .returning()
  return { purchaseOrderId: po.id, invoiceNumber: 'INV-44120', currency: 'USD', ...overrides }
}

describe('ProcurementDocumentsService', () => {
  let service: ProcurementDocumentsService
  let storage: { save: jest.Mock; delete: jest.Mock; getBuffer: jest.Mock }
  let parse: { queueDoc: jest.Mock }
  const prefix = `procurement-documents-spec-${Date.now()}-`

  beforeEach(() => {
    storage = {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('sku,qty\nA1,2\n')),
    }
    parse = { queueDoc: jest.fn().mockResolvedValue({ queued: true }) }
    service = new ProcurementDocumentsService(
      storage as unknown as StorageService,
      parse as unknown as ProcurementParseService,
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('uploads a purchase order, saves it to storage, and enqueues parsing', async () => {
    const workspace = await seedWorkspace(`${prefix}po-upload@example.com`, 'PO Upload')
    const file = {
      originalname: 'po.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA,1'),
    } as Express.Multer.File

    const header = await poHeader(workspace.id)
    const result = await service.upload(workspace.id, 'purchase_order', file, header)

    expect(result.name).toBe('po.csv')
    expect(result.status).toBe('pending')
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringContaining(`${workspace.id}/procurement/purchase_order/`),
      file.buffer,
      'text/csv',
    )
    expect(parse.queueDoc).toHaveBeenCalledWith('purchase_order', result.id)
    // S9. Not supplied, so the order date is unknown — null, never a stand-in.
    const [storedWithoutDate] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
    expect(storedWithoutDate.orderedAt).toBeNull()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
    expect(row.workspaceId).toBe(workspace.id)
    expect(row.sourceKind).toBe('csv')
  })

  it('records sourceKind xlsx for an .xlsx upload instead of collapsing it into csv', async () => {
    const workspace = await seedWorkspace(`${prefix}po-xlsx-upload@example.com`, 'PO XLSX Upload')
    const file = {
      originalname: 'po.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('xlsx bytes'),
    } as Express.Multer.File

    const result = await service.upload(workspace.id, 'purchase_order', file, await poHeader(workspace.id))

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
    expect(row.sourceKind).toBe('xlsx')
  })

  it('deletes the stored object when the document row cannot be created', async () => {
    const workspace = await seedWorkspace(`${prefix}po-orphan@example.com`, 'PO Orphan')
    // `name` is varchar(500): a longer filename makes the header insert fail after
    // the object has already been written to storage.
    const file = {
      originalname: `${'x'.repeat(600)}.csv`,
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA,1'),
    } as Express.Multer.File

    await expect(service.upload(workspace.id, 'purchase_order', file, await poHeader(workspace.id))).rejects.toThrow()

    const savedKey = storage.save.mock.calls[0][0] as string
    expect(storage.delete).toHaveBeenCalledWith(savedKey)
    expect(parse.queueDoc).not.toHaveBeenCalled()
  })

  it('derives sourceKind pdf for a .pdf upload', async () => {
    const workspace = await seedWorkspace(`${prefix}po-pdf-upload@example.com`, 'PO PDF Upload')
    const file = {
      originalname: 'po.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    } as Express.Multer.File

    const result = await service.upload(workspace.id, 'purchase_order', file, await poHeader(workspace.id))

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
    expect(row.sourceKind).toBe('pdf')
  })

  it('uploads an invoice into the invoices table', async () => {
    const workspace = await seedWorkspace(`${prefix}inv-upload@example.com`, 'Invoice Upload')
    const file = {
      originalname: 'invoice.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA,1'),
    } as Express.Multer.File

    const result = await service.upload(workspace.id, 'invoice', file, await invoiceHeader(workspace.id))

    expect(parse.queueDoc).toHaveBeenCalledWith('invoice', result.id)
    const [row] = await db.select().from(invoices).where(eq(invoices.id, result.id))
    expect(row.workspaceId).toBe(workspace.id)
  })

  it('marks the purchase order failed when enqueueing parse throws', async () => {
    const workspace = await seedWorkspace(`${prefix}po-enqueue-fail@example.com`, 'PO Enqueue Fail')
    parse.queueDoc.mockRejectedValue(new Error('queue down'))
    const file = {
      originalname: 'po.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA,1'),
    } as Express.Multer.File

    await expect(
      service.upload(workspace.id, 'purchase_order', file, await poHeader(workspace.id)),
    ).rejects.toThrow('queue down')

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspace.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('lists purchase orders for a workspace newest-first', async () => {
    const workspace = await seedWorkspace(`${prefix}po-list@example.com`, 'PO List')
    await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'a.csv', status: 'done' })
    await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'b.csv', status: 'pending' })

    const items = await service.listPurchaseOrders(workspace.id)

    expect(items.map((item) => item.name)).toEqual(['b.csv', 'a.csv'])
  })

  it('deletes a purchase order and its storage object', async () => {
    const workspace = await seedWorkspace(`${prefix}po-delete@example.com`, 'PO Delete')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'a.csv', status: 'done', storageKey: 'k/a.csv' })
      .returning()

    await service.remove(workspace.id, 'purchase_order', po.id)

    expect(storage.delete).toHaveBeenCalledWith('k/a.csv')
    const remaining = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(remaining).toHaveLength(0)
  })

  it('rejects deleting a purchase order that belongs to another workspace', async () => {
    const mine = await seedWorkspace(`${prefix}po-delete-mine@example.com`, 'PO Mine')
    const other = await seedWorkspace(`${prefix}po-delete-other@example.com`, 'PO Other')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: other.id, name: 'a.csv', status: 'done' })
      .returning()

    await expect(service.remove(mine.id, 'purchase_order', po.id)).rejects.toThrow('Purchase order not found')
  })

  // POLICY v1 #9. remove() has no route and no production caller; this pins the
  // guard so exposing it later cannot cascade away a run and its flags.
  describe('getDownloadable (S4)', () => {
    it('returns the original name and bytes for a purchase order', async () => {
      const workspace = await seedWorkspace(`${prefix}dl-po@example.com`, 'Download PO')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'march-po.csv', status: 'done', storageKey: 'k/march-po.csv' })
        .returning()

      const result = await service.getDownloadable(workspace.id, 'purchase_order', po.id)

      expect(storage.getBuffer).toHaveBeenCalledWith('k/march-po.csv')
      expect(result.name).toBe('march-po.csv')
      expect(result.buffer.toString()).toBe('sku,qty\nA1,2\n')
    })

    it('returns the original name and bytes for an invoice', async () => {
      const workspace = await seedWorkspace(`${prefix}dl-inv@example.com`, 'Download Invoice')
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId: workspace.id, name: 'march-inv.xlsx', status: 'done', storageKey: 'k/march-inv.xlsx' })
        .returning()

      const result = await service.getDownloadable(workspace.id, 'invoice', invoice.id)

      expect(storage.getBuffer).toHaveBeenCalledWith('k/march-inv.xlsx')
      expect(result.name).toBe('march-inv.xlsx')
    })

    // A 404 rather than a 403, so it does not confirm the row exists elsewhere.
    it('refuses a document from another workspace without reading storage', async () => {
      const mine = await seedWorkspace(`${prefix}dl-mine@example.com`, 'Download Mine')
      const other = await seedWorkspace(`${prefix}dl-other@example.com`, 'Download Other')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: other.id, name: 'theirs.csv', status: 'done', storageKey: 'k/theirs.csv' })
        .returning()

      await expect(service.getDownloadable(mine.id, 'purchase_order', po.id)).rejects.toThrow(
        'Purchase order not found',
      )
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    // storageKey is nullable in the schema and e2e fixtures insert rows without
    // one, so "no bytes" is a distinct outcome from "no such document".
    it('reports a document that has no stored file separately from a missing one', async () => {
      const workspace = await seedWorkspace(`${prefix}dl-nokey@example.com`, 'Download No Key')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'no-bytes.csv', status: 'done' })
        .returning()

      await expect(service.getDownloadable(workspace.id, 'purchase_order', po.id)).rejects.toThrow(
        'Purchase order has no stored file',
      )
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    // The row says there is a file and storage says there is not - deleted by
    // hand, lost with a bucket, never copied across. That is a 404 the UI can
    // explain, not a 500 that reads as an outage.
    it('answers 404 when the stored file itself is gone', async () => {
      const workspace = await seedWorkspace(`${prefix}dl-gone@example.com`, 'Download Gone')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'gone.csv', status: 'done', storageKey: 'k/gone.csv' })
        .returning()
      storage.getBuffer.mockRejectedValueOnce(new StorageObjectNotFoundError('k/gone.csv'))

      const error = await service.getDownloadable(workspace.id, 'purchase_order', po.id).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(NotFoundException)
      expect((error as Error).message).toBe('Purchase order file is missing')
    })

    it('still fails loudly when storage itself is unreachable', async () => {
      const workspace = await seedWorkspace(`${prefix}dl-down@example.com`, 'Download Down')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'down.csv', status: 'done', storageKey: 'k/down.csv' })
        .returning()
      const outage = new Error('connect ECONNREFUSED')
      storage.getBuffer.mockRejectedValueOnce(outage)

      await expect(service.getDownloadable(workspace.id, 'purchase_order', po.id)).rejects.toBe(outage)
    })
  })

  describe('list hasSourceFile (S4)', () => {
    it('reports whether a row has bytes without exposing the storage key', async () => {
      const workspace = await seedWorkspace(`${prefix}list-haskey@example.com`, 'List Has Key')
      await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'with.csv', status: 'done', storageKey: 'k/with.csv' })
      await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'without.csv', status: 'done' })

      const rows = await service.listPurchaseOrders(workspace.id)
      const byName = new Map(rows.map((row) => [row.name, row]))

      expect(byName.get('with.csv')?.hasSourceFile).toBe(true)
      expect(byName.get('without.csv')?.hasSourceFile).toBe(false)
      expect(rows.every((row) => !('storageKey' in row))).toBe(true)
    })
  })

  it('refuses to delete a purchase order referenced by a comparison run', async () => {
    const workspace = await seedWorkspace(`${prefix}po-referenced@example.com`, 'PO Referenced')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'a.csv', status: 'done', storageKey: 'k/a.csv' })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'b.csv', status: 'done' })
      .returning()
    await db
      .insert(comparisonRuns)
      .values({ workspaceId: workspace.id, purchaseOrderId: po.id, invoiceId: invoice.id, status: 'succeeded' })

    await expect(service.remove(workspace.id, 'purchase_order', po.id)).rejects.toThrow(
      'referenced by a comparison run',
    )

    expect(storage.delete).not.toHaveBeenCalled()
    const remaining = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(remaining).toHaveLength(1)
  })

  it('refuses to delete an invoice referenced by a comparison run', async () => {
    const workspace = await seedWorkspace(`${prefix}inv-referenced@example.com`, 'Invoice Referenced')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'a.csv', status: 'done' })
      .returning()
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'b.csv', status: 'done' })
      .returning()
    await db
      .insert(comparisonRuns)
      .values({ workspaceId: workspace.id, purchaseOrderId: po.id, invoiceId: invoice.id, status: 'succeeded' })

    await expect(service.remove(workspace.id, 'invoice', invoice.id)).rejects.toThrow(
      'referenced by a comparison run',
    )
  })

  // S5. Ingest for the receiving side. The comparison that consumes these is S6;
  // what matters here is that the rows land in the right table with the link
  // POLICY v1 #2 requires, and that "not stated" survives as null.
  describe('goods receipts (S5)', () => {
    const csv = () =>
      ({ originalname: 'grn.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,qty received\nA1,8') }) as Express.Multer.File

    it('persists the grn number and the linked purchase order', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-upload@example.com`, 'GRN Upload')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()

      const result = await service.upload(workspace.id, 'goods_receipt', csv(), {
        purchaseOrderId: po.id,
        grnNumber: 'GRN-9001',
      })

      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, result.id))
      expect(row.purchaseOrderId).toBe(po.id)
      expect(row.grnNumber).toBe('GRN-9001')
      expect(row.workspaceId).toBe(workspace.id)
      expect(parse.queueDoc).toHaveBeenCalledWith('goods_receipt', result.id)
    })

    // The regression the whole exhaustiveness refactor exists to prevent: with
    // a bare `kind === 'purchase_order' ? … : …` this row lands in `invoices`.
    it('writes to goods_receipts and not to invoices', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-table@example.com`, 'GRN Table')

      const result = await service.upload(workspace.id, 'goods_receipt', csv(), await grnHeader(workspace.id))

      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, result.id))).toHaveLength(1)
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, workspace.id))).toHaveLength(0)
    })

    it('refuses a purchase order from another workspace and never writes the object', async () => {
      const mine = await seedWorkspace(`${prefix}grn-po-mine@example.com`, 'GRN PO Mine')
      const other = await seedWorkspace(`${prefix}grn-po-other@example.com`, 'GRN PO Other')
      const [foreignPo] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: other.id, name: 'theirs.csv', status: 'done' })
        .returning()

      await expect(
        service.upload(mine.id, 'goods_receipt', csv(), { purchaseOrderId: foreignPo.id, grnNumber: 'GRN-1' }),
      ).rejects.toThrow('Purchase order not found')

      expect(storage.save).not.toHaveBeenCalled()
    })

    // POLICY v1 #14: accepted quantity is summed across every GRN linked to the
    // PO, so nothing may constrain a purchase order to a single receipt.
    it('accepts more than one receipt against the same purchase order', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-multi@example.com`, 'GRN Multi')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()

      const first = await service.upload(workspace.id, 'goods_receipt', csv(), {
        purchaseOrderId: po.id,
        grnNumber: 'GRN-1',
      })
      const second = await service.upload(workspace.id, 'goods_receipt', csv(), {
        purchaseOrderId: po.id,
        grnNumber: 'GRN-2',
      })

      expect(first.id).not.toBe(second.id)
      const rows = await db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, po.id))
      expect(rows).toHaveLength(2)
    })

    // POLICY v1 #9: a document referenced by a comparison run is evidence and
    // cannot be hard-deleted. S5 shipped this branch uncovered because no run
    // could reference a receipt yet; S6 is where it starts to matter.
    it('refuses to delete a goods receipt that a comparison run read', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-retained@example.com`, 'GRN Retained')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId: workspace.id, name: 'inv.csv', status: 'done' })
        .returning()
      const [grn] = await db
        .insert(goodsReceipts)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, name: 'grn.csv', status: 'done' })
        .returning()
      const [run] = await db
        .insert(comparisonRuns)
        .values({
          workspaceId: workspace.id,
          purchaseOrderId: po.id,
          invoiceId: invoice.id,
          mode: 'three_way',
          status: 'succeeded',
        })
        .returning()
      await db
        .insert(comparisonRunGoodsReceipts)
        .values({ comparisonRunId: run.id, goodsReceiptId: grn.id })

      await expect(service.remove(workspace.id, 'goods_receipt', grn.id)).rejects.toThrow(
        'referenced by a comparison run',
      )

      expect(storage.delete).not.toHaveBeenCalled()
      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))).toHaveLength(1)
    })

    it('still deletes a goods receipt no run has read', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-deletable@example.com`, 'GRN Deletable')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()
      const [grn] = await db
        .insert(goodsReceipts)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, name: 'grn.csv', status: 'done' })
        .returning()

      await service.remove(workspace.id, 'goods_receipt', grn.id)

      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))).toHaveLength(0)
    })

    it('lists goods receipts with their header fields, newest first', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-list@example.com`, 'GRN List')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()
      await db
        .insert(goodsReceipts)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, name: 'a.csv', status: 'done', grnNumber: 'GRN-A' })
      await db
        .insert(goodsReceipts)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, name: 'b.csv', status: 'done', grnNumber: 'GRN-B' })

      const items = await service.listGoodsReceipts(workspace.id)

      expect(items.map((item) => item.name)).toEqual(['b.csv', 'a.csv'])
      expect(items[0].grnNumber).toBe('GRN-B')
      expect(items[0].purchaseOrderId).toBe(po.id)
      expect(items[0].hasSourceFile).toBe(false)
    })
  })

  // S3b. The foreign key proves the row exists; it does not prove it belongs to
  // the caller's workspace. Without the explicit scope check these tests pin,
  // an owner of workspace A could attach workspace B's vendor and the database
  // would accept it — the worst class of bug in a multi-tenant product.
  describe('header enrichment and linkage (S3b)', () => {
    const csv = () =>
      ({ originalname: 'po.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,qty\nA,1') }) as Express.Multer.File

    it('persists vendorId, poNumber and currency on a purchase order upload', async () => {
      const workspace = await seedWorkspace(`${prefix}po-header@example.com`, 'PO Header')
      const vendor = await seedVendor(workspace.id, 'Brightline Systems')

      const result = await service.upload(workspace.id, 'purchase_order', csv(), {
        vendorId: vendor.id,
        poNumber: 'PO-2026-1184',
        currency: 'USD',
      })

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
      expect(row.vendorId).toBe(vendor.id)
      expect(row.poNumber).toBe('PO-2026-1184')
      expect(row.currency).toBe('USD')
    })

    it('refuses a vendor from another workspace and never writes the object', async () => {
      const mine = await seedWorkspace(`${prefix}po-vendor-mine@example.com`, 'PO Vendor Mine')
      const other = await seedWorkspace(`${prefix}po-vendor-other@example.com`, 'PO Vendor Other')
      const foreignVendor = await seedVendor(other.id, 'Cedar Supply Co')

      await expect(
        service.upload(mine.id, 'purchase_order', csv(), {
          vendorId: foreignVendor.id,
          poNumber: 'PO-1',
          currency: 'USD',
        }),
      ).rejects.toThrow('Vendor not found')

      // Validated before storage.save, so a rejected header leaves no orphan object.
      expect(storage.save).not.toHaveBeenCalled()
      const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, mine.id))
      expect(rows).toHaveLength(0)
    })

    it('persists purchaseOrderId, invoiceNumber and currency on an invoice upload', async () => {
      const workspace = await seedWorkspace(`${prefix}inv-header@example.com`, 'Invoice Header')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'linked.csv', status: 'done' })
        .returning()

      const result = await service.upload(workspace.id, 'invoice', csv(), {
        purchaseOrderId: po.id,
        invoiceNumber: 'INV-44257',
        currency: 'EUR',
      })

      const [row] = await db.select().from(invoices).where(eq(invoices.id, result.id))
      expect(row.purchaseOrderId).toBe(po.id)
      expect(row.invoiceNumber).toBe('INV-44257')
      expect(row.currency).toBe('EUR')
    })

    it('refuses a purchase order from another workspace and never writes the object', async () => {
      const mine = await seedWorkspace(`${prefix}inv-po-mine@example.com`, 'Invoice PO Mine')
      const other = await seedWorkspace(`${prefix}inv-po-other@example.com`, 'Invoice PO Other')
      const [foreignPo] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: other.id, name: 'theirs.csv', status: 'done' })
        .returning()

      await expect(
        service.upload(mine.id, 'invoice', csv(), {
          purchaseOrderId: foreignPo.id,
          invoiceNumber: 'INV-1',
          currency: 'USD',
        }),
      ).rejects.toThrow('Purchase order not found')

      expect(storage.save).not.toHaveBeenCalled()
    })

    it('returns the header fields and the joined vendor name when listing purchase orders', async () => {
      const workspace = await seedWorkspace(`${prefix}po-list-header@example.com`, 'PO List Header')
      const vendor = await seedVendor(workspace.id, 'Nordwerk Interiors')
      await db.insert(purchaseOrders).values({
        workspaceId: workspace.id,
        name: 'a.csv',
        status: 'done',
        vendorId: vendor.id,
        poNumber: 'PO-2026-1180',
        currency: 'USD',
      })

      const [item] = await service.listPurchaseOrders(workspace.id)

      expect(item.vendorId).toBe(vendor.id)
      expect(item.vendorName).toBe('Nordwerk Interiors')
      expect(item.poNumber).toBe('PO-2026-1180')
      expect(item.currency).toBe('USD')
    })

    // A row written before migration 0025 has no vendor. The join must not drop
    // it from the list, and the response must carry nulls rather than omitting
    // the keys — the UI renders a dash, not a crash.
    it('still lists a legacy purchase order that has no vendor', async () => {
      const workspace = await seedWorkspace(`${prefix}po-legacy@example.com`, 'PO Legacy')
      await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'legacy.csv', status: 'done' })

      const [item] = await service.listPurchaseOrders(workspace.id)

      expect(item.name).toBe('legacy.csv')
      expect(item.vendorId).toBeNull()
      expect(item.vendorName).toBeNull()
    })

    it('returns the header fields when listing invoices', async () => {
      const workspace = await seedWorkspace(`${prefix}inv-list-header@example.com`, 'Invoice List Header')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'linked.csv', status: 'done' })
        .returning()
      await db.insert(invoices).values({
        workspaceId: workspace.id,
        name: 'b.csv',
        status: 'done',
        purchaseOrderId: po.id,
        invoiceNumber: 'INV-44120',
        currency: 'USD',
      })

      const [item] = await service.listInvoices(workspace.id)

      expect(item.purchaseOrderId).toBe(po.id)
      expect(item.invoiceNumber).toBe('INV-44120')
      expect(item.currency).toBe('USD')
    })
  })

  // S9. Contract applicability asks whether an agreed price was live when the
  // order was PLACED. Without this the only date available is when the file was
  // uploaded, so a January order uploaded in June is judged against June's
  // contract — a variance flag that is simply wrong.
  it('stores the order date the uploader supplied, distinct from when the file arrived', async () => {
    const workspace = await seedWorkspace(`${prefix}ordered-at@example.com`, 'Ordered At')
    const file = {
      originalname: 'po.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA,1'),
    } as Express.Multer.File

    const header = await poHeader(workspace.id, { orderedAt: '2026-01-14T00:00:00.000Z' } as never)
    const result = await service.upload(workspace.id, 'purchase_order', file, header)

    const [stored] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
    expect(stored.orderedAt?.toISOString()).toBe('2026-01-14T00:00:00.000Z')
    // The upload timestamp is still recorded separately — one is when we were
    // told, the other is when it happened.
    expect(stored.createdAt).not.toBeNull()
  })

  // B8. busboy reads a browser's UTF-8 filename as latin1; the stored name and
  // key used to keep that mojibake.
  describe('non-ASCII filenames (B8)', () => {
    it('regression: stores a UTF-8 filename the multipart parser read as latin1 under its real name', async () => {
      const workspace = await seedWorkspace(`${prefix}b8-name@example.com`, 'B8 Name')
      const file = {
        originalname: Buffer.from('façture-日本.csv', 'utf8').toString('latin1'),
        mimetype: 'text/csv',
        buffer: Buffer.from('sku,qty\nA,1'),
      } as Express.Multer.File

      const result = await service.upload(workspace.id, 'purchase_order', file, await poHeader(workspace.id))

      expect(result.name).toBe('façture-日本.csv')
      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
      expect(row.name).toBe('façture-日本.csv')
      expect(row.storageKey).toMatch(/-façture-日本\.csv$/)
      expect(row.sourceKind).toBe('csv')
    })
  })

  // Photo intake. Real sharp normalises the inputs; storage and the queue are fakes.
  describe('photo intake', () => {
    async function photo(name: string, width = 120, height = 80): Promise<Express.Multer.File> {
      const buffer = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
      return { originalname: name, mimetype: 'image/jpeg', buffer } as Express.Multer.File
    }

    function notAnImage(name = 'junk.jpg'): Express.Multer.File {
      return { originalname: name, mimetype: 'image/jpeg', buffer: Buffer.from('this is not an image at all') } as Express.Multer.File
    }

    function heic(): Express.Multer.File {
      const buffer = Buffer.alloc(32)
      buffer.writeUInt32BE(24, 0)
      buffer.write('ftyp', 4, 'latin1')
      buffer.write('mif1', 8, 'latin1')
      return { originalname: 'IMG_0001.heic', mimetype: 'image/heic', buffer } as Express.Multer.File
    }

    async function countRows(workspaceId: string) {
      return (await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspaceId))).length
    }

    it('error: a vendor from another workspace is a 404 and nothing is processed or stored', async () => {
      const a = await seedWorkspace(`${prefix}photo-idor-a@example.com`, 'Photo IDOR A')
      const b = await seedWorkspace(`${prefix}photo-idor-b@example.com`, 'Photo IDOR B')
      const foreignHeader = await poHeader(b.id)

      await expect(
        service.uploadPhotos(a.id, 'purchase_order', [await photo('po.jpg')], foreignHeader),
      ).rejects.toBeInstanceOf(NotFoundException)

      expect(storage.save).not.toHaveBeenCalled()
      expect(parse.queueDoc).not.toHaveBeenCalled()
    })

    it('error: a HEIC file is a 400 with the HEIC message and nothing is stored', async () => {
      const ws = await seedWorkspace(`${prefix}photo-heic@example.com`, 'Photo HEIC')

      const err = await service
        .uploadPhotos(ws.id, 'purchase_order', [heic()], await poHeader(ws.id))
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(BadRequestException)
      expect((err as Error).message).toBe('HEIC/HEIF photos are not supported — export as JPEG and upload again')
      expect(storage.save).not.toHaveBeenCalled()
      expect(await countRows(ws.id)).toBe(0)
      expect(parse.queueDoc).not.toHaveBeenCalled()
    })

    it('error: a bad second file names its position and no page of the batch is stored', async () => {
      const ws = await seedWorkspace(`${prefix}photo-bad2@example.com`, 'Photo Bad 2')

      const err = await service
        .uploadPhotos(ws.id, 'purchase_order', [await photo('1.jpg'), notAnImage('2.jpg')], await poHeader(ws.id))
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(BadRequestException)
      expect((err as Error).message).toBe('Photo 2 is not a JPEG, PNG or WebP image')
      expect(storage.save).not.toHaveBeenCalled()
      expect(await countRows(ws.id)).toBe(0)
    })

    it('error: a failed page save deletes the pages already saved, writes no row and does not queue', async () => {
      const ws = await seedWorkspace(`${prefix}photo-save-fail@example.com`, 'Photo Save Fail')
      storage.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('s3 down'))

      await expect(
        service.uploadPhotos(ws.id, 'purchase_order', [await photo('a.jpg'), await photo('b.jpg')], await poHeader(ws.id)),
      ).rejects.toThrow('s3 down')

      const firstKey = storage.save.mock.calls[0][0] as string
      expect(firstKey).toMatch(/\/1\.jpg$/)
      expect(storage.delete).toHaveBeenCalledWith(firstKey)
      expect(await countRows(ws.id)).toBe(0)
      expect(parse.queueDoc).not.toHaveBeenCalled()
    })

    it('error: a failed PDF save deletes every page object', async () => {
      const ws = await seedWorkspace(`${prefix}photo-pdf-fail@example.com`, 'Photo PDF Fail')
      // pages 1 and 2 save, the stitched PDF (third save) fails.
      storage.save.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('pdf save failed'))

      await expect(
        service.uploadPhotos(ws.id, 'purchase_order', [await photo('a.jpg'), await photo('b.jpg')], await poHeader(ws.id)),
      ).rejects.toThrow('pdf save failed')

      const pageKeys = [storage.save.mock.calls[0][0], storage.save.mock.calls[1][0]] as string[]
      const deleted = storage.delete.mock.calls.map((c) => c[0])
      for (const key of pageKeys) {
        expect(deleted).toContain(key)
      }
      expect(await countRows(ws.id)).toBe(0)
    })

    it('error: a failed header insert deletes all pages and the PDF', async () => {
      const ws = await seedWorkspace(`${prefix}photo-insert-fail@example.com`, 'Photo Insert Fail')
      // po_number is varchar(200): a longer value fails the insert after every object was saved.
      // (A long file name no longer does: it is cut to 100 characters first.)
      const header = await poHeader(ws.id, { poNumber: 'P'.repeat(300) })

      await expect(
        service.uploadPhotos(ws.id, 'purchase_order', [await photo('a.jpg'), await photo('b.jpg')], header),
      ).rejects.toThrow()

      const saved = storage.save.mock.calls.map((c) => c[0] as string)
      expect(saved).toHaveLength(3)
      const deleted = storage.delete.mock.calls.map((c) => c[0])
      for (const key of saved) {
        expect(deleted).toContain(key)
      }
      expect(parse.queueDoc).not.toHaveBeenCalled()
    })

    it('error: a cleanup delete that itself fails does not mask the original error', async () => {
      const ws = await seedWorkspace(`${prefix}photo-cleanup-fail@example.com`, 'Photo Cleanup Fail')
      storage.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('s3 down'))
      storage.delete.mockRejectedValue(new Error('delete also down'))

      await expect(
        service.uploadPhotos(ws.id, 'purchase_order', [await photo('a.jpg'), await photo('b.jpg')], await poHeader(ws.id)),
      ).rejects.toThrow('s3 down')
    })

    it('error: when enqueueing parse throws the document is marked failed and the error surfaces', async () => {
      const ws = await seedWorkspace(`${prefix}photo-queue-fail@example.com`, 'Photo Queue Fail')
      parse.queueDoc.mockRejectedValueOnce(new Error('redis down'))

      await expect(
        service.uploadPhotos(ws.id, 'purchase_order', [await photo('a.jpg')], await poHeader(ws.id)),
      ).rejects.toThrow('redis down')

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, ws.id))
      expect(row.status).toBe('failed')
      expect(row.lastError).toContain('Queue enqueue failed')
    })

    it('edge: the document is named after the first photo with a .pdf extension', async () => {
      const ws = await seedWorkspace(`${prefix}photo-name@example.com`, 'Photo Name')

      const result = await service.uploadPhotos(
        ws.id,
        'purchase_order',
        [await photo('Scan 2026-10-06.JPG'), await photo('page2.jpg')],
        await poHeader(ws.id),
      )

      expect(result.name).toBe('Scan 2026-10-06.pdf')
    })

    it('edge: a 300-character photo name is cut to 100 characters before the .pdf name and the storage key', async () => {
      const ws = await seedWorkspace(`${prefix}photo-longname@example.com`, 'Photo Long Name')

      const result = await service.uploadPhotos(
        ws.id,
        'purchase_order',
        [await photo(`${'n'.repeat(300)}.jpg`)],
        await poHeader(ws.id),
      )

      expect(result.name).toBe(`${'n'.repeat(100)}.pdf`)
      const savedKeys = storage.save.mock.calls.map((c) => c[0] as string)
      expect(savedKeys.some((key) => key.endsWith(`/${'n'.repeat(100)}.pdf`))).toBe(true)
      expect(savedKeys.every((key) => !key.includes('n'.repeat(101)))).toBe(true)
    })

    it('edge: the maximum of 5 photos stores 5 pages plus the PDF and records pageCount 5', async () => {
      const ws = await seedWorkspace(`${prefix}photo-five@example.com`, 'Photo Five')
      const files = await Promise.all([1, 2, 3, 4, 5].map((n) => photo(`p${n}.jpg`)))

      const result = await service.uploadPhotos(ws.id, 'purchase_order', files, await poHeader(ws.id))

      expect(storage.save).toHaveBeenCalledTimes(6)
      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
      expect(row.pageCount).toBe(5)
    })

    it('edge: a goods receipt photo upload writes goods_receipts, never the other tables', async () => {
      const ws = await seedWorkspace(`${prefix}photo-grn@example.com`, 'Photo GRN')

      const result = await service.uploadPhotos(ws.id, 'goods_receipt', [await photo('grn.jpg')], await grnHeader(ws.id))

      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, result.id))
      expect(row).toMatchObject({ sourceKind: 'image', reviewRequired: true, pageCount: 1, status: 'pending' })
      expect(row.grnNumber).toBe('GRN-9001')
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, ws.id))).toHaveLength(0)
      expect(parse.queueDoc).toHaveBeenCalledWith('goods_receipt', result.id)
    })

    it('regression: the single-file upload of a CSV still creates a non-review document', async () => {
      const ws = await seedWorkspace(`${prefix}photo-regress-csv@example.com`, 'Photo Regress CSV')
      const file = { originalname: 'po.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,qty\nA,1') } as Express.Multer.File

      const result = await service.upload(ws.id, 'purchase_order', file, await poHeader(ws.id))

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
      expect(row).toMatchObject({ sourceKind: 'csv', reviewRequired: false, reviewedAt: null, pageCount: null, detectedKind: null })
    })

    it('happy: 2 photos create one image document: pages then the stitched PDF are stored, review is required, parse is queued', async () => {
      const ws = await seedWorkspace(`${prefix}photo-happy@example.com`, 'Photo Happy')

      const result = await service.uploadPhotos(
        ws.id,
        'purchase_order',
        [await photo('po.jpg'), await photo('po-2.jpg')],
        await poHeader(ws.id),
      )

      expect(result).toEqual({ id: expect.any(String), name: 'po.pdf', status: 'pending' })
      const saves = storage.save.mock.calls
      expect(saves).toHaveLength(3)
      const [page1, page2, pdf] = saves
      expect(page1[0]).toMatch(new RegExp(`^${ws.id}/procurement/purchase_order/[0-9a-f-]{36}-pages/1\\.jpg$`))
      expect(page2[0]).toMatch(/-pages\/2\.jpg$/)
      expect(page1[2]).toBe('image/jpeg')
      expect(pdf[0]).toMatch(/-pages\/po\.pdf$/)
      expect(pdf[2]).toBe('application/pdf')
      expect(Buffer.from(pdf[1] as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF')

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
      expect(row).toMatchObject({
        workspaceId: ws.id,
        sourceKind: 'image',
        reviewRequired: true,
        reviewedAt: null,
        pageCount: 2,
        status: 'pending',
        storageKey: pdf[0],
      })
      expect(parse.queueDoc).toHaveBeenCalledWith('purchase_order', result.id)
    })

    describe('list projections', () => {
      it('edge: a photo purchase order lists sourceKind, pageCount, reviewRequired, reviewedAt and detectedKind', async () => {
        const ws = await seedWorkspace(`${prefix}photo-list-po@example.com`, 'Photo List PO')
        await service.uploadPhotos(ws.id, 'purchase_order', [await photo('po.jpg'), await photo('b.jpg')], await poHeader(ws.id))

        const [item] = await service.listPurchaseOrders(ws.id)

        expect(item).toMatchObject({
          sourceKind: 'image',
          pageCount: 2,
          reviewRequired: true,
          reviewedAt: null,
          detectedKind: null,
          hasSourceFile: true,
        })
        expect(item).not.toHaveProperty('storageKey')
      })

      it('edge: photo invoices and goods receipts list the same five fields', async () => {
        const ws = await seedWorkspace(`${prefix}photo-list-others@example.com`, 'Photo List Others')
        await service.uploadPhotos(ws.id, 'invoice', [await photo('inv.jpg')], await invoiceHeader(ws.id))
        await service.uploadPhotos(ws.id, 'goods_receipt', [await photo('grn.jpg')], await grnHeader(ws.id))

        const [invoice] = await service.listInvoices(ws.id)
        const [receipt] = await service.listGoodsReceipts(ws.id)

        for (const item of [invoice, receipt]) {
          expect(item).toMatchObject({ sourceKind: 'image', pageCount: 1, reviewRequired: true, reviewedAt: null, detectedKind: null })
        }
      })

      it('regression: a CSV purchase order lists reviewRequired false and a null pageCount', async () => {
        const ws = await seedWorkspace(`${prefix}photo-list-csv@example.com`, 'Photo List CSV')
        const file = { originalname: 'po.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,qty\nA,1') } as Express.Multer.File
        await service.upload(ws.id, 'purchase_order', file, await poHeader(ws.id))

        const [item] = await service.listPurchaseOrders(ws.id)

        expect(item).toMatchObject({ sourceKind: 'csv', reviewRequired: false, reviewedAt: null, pageCount: null, detectedKind: null })
      })
    })

    describe('remove', () => {
      it('edge: removing a photo document deletes the PDF and every page object', async () => {
        const ws = await seedWorkspace(`${prefix}photo-remove@example.com`, 'Photo Remove')
        const result = await service.uploadPhotos(
          ws.id,
          'purchase_order',
          [await photo('po.jpg'), await photo('b.jpg'), await photo('c.jpg')],
          await poHeader(ws.id),
        )
        const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, result.id))
        const dir = (row.storageKey as string).replace(/\/[^/]+$/, '')
        storage.delete.mockClear()

        await service.remove(ws.id, 'purchase_order', result.id)

        const deleted = storage.delete.mock.calls.map((c) => c[0])
        expect(deleted).toEqual(expect.arrayContaining([row.storageKey, `${dir}/1.jpg`, `${dir}/2.jpg`, `${dir}/3.jpg`]))
        expect(deleted).toHaveLength(4)
        expect(await countRows(ws.id)).toBe(0)
      })

      it('edge: a failing page delete is logged, not thrown, and the row is still removed', async () => {
        const ws = await seedWorkspace(`${prefix}photo-remove-fail@example.com`, 'Photo Remove Fail')
        const result = await service.uploadPhotos(ws.id, 'purchase_order', [await photo('po.jpg'), await photo('b.jpg')], await poHeader(ws.id))
        storage.delete.mockRejectedValue(new Error('s3 down'))

        await expect(service.remove(ws.id, 'purchase_order', result.id)).resolves.toEqual({ message: 'Purchase order deleted' })

        expect(await countRows(ws.id)).toBe(0)
      })

      it('regression: removing a CSV document still deletes exactly one object', async () => {
        const ws = await seedWorkspace(`${prefix}photo-remove-csv@example.com`, 'Photo Remove CSV')
        const file = { originalname: 'po.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,qty\nA,1') } as Express.Multer.File
        const result = await service.upload(ws.id, 'purchase_order', file, await poHeader(ws.id))
        storage.delete.mockClear()

        await service.remove(ws.id, 'purchase_order', result.id)

        expect(storage.delete).toHaveBeenCalledTimes(1)
      })
    })
  })
})
