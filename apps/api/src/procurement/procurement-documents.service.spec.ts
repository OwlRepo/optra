import { eq, like } from 'drizzle-orm'
import { db, invoices, pool, purchaseOrders, users, workspaceMembers, workspaces } from '@repo/db'
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
  let storage: { save: jest.Mock; delete: jest.Mock }
  let parse: { queueDoc: jest.Mock }
  const prefix = `procurement-documents-spec-${Date.now()}-`

  beforeEach(() => {
    storage = { save: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) }
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
})
