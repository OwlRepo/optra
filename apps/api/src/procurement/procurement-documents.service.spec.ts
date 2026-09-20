import { eq, like } from 'drizzle-orm'
import { comparisonRuns, db, invoices, pool, purchaseOrders, users, workspaceMembers, workspaces } from '@repo/db'
import { ProcurementDocumentsService } from './procurement-documents.service'
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

    const result = await service.upload(workspace.id, 'purchase_order', file)

    expect(result.name).toBe('po.csv')
    expect(result.status).toBe('pending')
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringContaining(`${workspace.id}/procurement/purchase_order/`),
      file.buffer,
      'text/csv',
    )
    expect(parse.queueDoc).toHaveBeenCalledWith('purchase_order', result.id)

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

    const result = await service.upload(workspace.id, 'purchase_order', file)

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

    await expect(service.upload(workspace.id, 'purchase_order', file)).rejects.toThrow()

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

    const result = await service.upload(workspace.id, 'purchase_order', file)

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

    const result = await service.upload(workspace.id, 'invoice', file)

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

    await expect(service.upload(workspace.id, 'purchase_order', file)).rejects.toThrow('queue down')

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspace.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('lists purchase orders for a workspace newest-first', async () => {
    const workspace = await seedWorkspace(`${prefix}po-list@example.com`, 'PO List')
    await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'a.csv', status: 'done' })
    await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'b.csv', status: 'pending' })

    const items = await service.list(workspace.id, 'purchase_order')

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
  })

  describe('list hasSourceFile (S4)', () => {
    it('reports whether a row has bytes without exposing the storage key', async () => {
      const workspace = await seedWorkspace(`${prefix}list-haskey@example.com`, 'List Has Key')
      await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'with.csv', status: 'done', storageKey: 'k/with.csv' })
      await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'without.csv', status: 'done' })

      const rows = await service.list(workspace.id, 'purchase_order')
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
})
