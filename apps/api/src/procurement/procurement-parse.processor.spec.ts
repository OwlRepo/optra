import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import {
  db,
  invoiceLineItems,
  invoices,
  pool,
  poLineItems,
  purchaseOrders,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { ProcurementParseProcessor } from './procurement-parse.processor'
import { StorageService } from '../storage/storage.service'

const mockEmbedQuery = jest.fn()

jest.mock('@repo/ai', () => ({
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
}))

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
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

describe('ProcurementParseProcessor', () => {
  const prefix = `procurement-parse-proc-spec-${Date.now()}-`
  let dir: string
  let storage: { getToTempFile: jest.Mock; save: jest.Mock }
  let processor: ProcurementParseProcessor

  beforeEach(() => {
    jest.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'procurement-parse-proc-spec-'))
    storage = { getToTempFile: jest.fn(), save: jest.fn().mockResolvedValue(undefined) }
    processor = new ProcurementParseProcessor(storage as unknown as StorageService)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedWorkspace(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    return workspace
  }

  async function seedPo(csvContent: string, workspaceId: string, name = 'po.csv') {
    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, csvContent)
    storage.getToTempFile.mockResolvedValue(csvPath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId, name, storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    return po
  }

  it('parses PO line items, infers mapped fields, and marks done', async () => {
    const workspace = await seedWorkspace(`${prefix}po@example.com`, prefix)
    const po = await seedPo(
      ['sku,description,qty,unit price', 'A1,Widget,10,5.00', 'B2,Gadget,3,9.99'].join('\n'),
      workspace.id,
    )

    await processor.handleParse({ id: 'job-1', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)

    const items = await db
      .select()
      .from(poLineItems)
      .where(eq(poLineItems.purchaseOrderId, po.id))
      .orderBy(poLineItems.lineNumber)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sku: 'A1',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.00',
      workspaceId: workspace.id,
    })
    expect(items[0].rawRow).toEqual({ sku: 'A1', description: 'Widget', qty: '10', 'unit price': '5.00' })

    expect(mockEmbedQuery).not.toHaveBeenCalled()
  })

  it('parses invoice line items into invoice_line_items', async () => {
    const workspace = await seedWorkspace(`${prefix}inv@example.com`, prefix)
    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, ['sku,qty,unit price', 'A1,10,5.00'].join('\n'))
    storage.getToTempFile.mockResolvedValue(csvPath)
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'invoice.csv', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-2', data: { kind: 'invoice', id: invoice.id } } as any)

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(updated.status).toBe('done')

    const items = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBe('A1')
  })

  it('converts an XLSX PO upload to CSV, parses it, and overwrites storage with the converted CSV', async () => {
    const workspace = await seedWorkspace(`${prefix}po-xlsx@example.com`, prefix)
    const worksheet = XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 5 }])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const xlsxPath = join(dir, `${randomUUID()}.xlsx`)
    writeFileSync(xlsxPath, buffer)
    storage.getToTempFile.mockResolvedValue(xlsxPath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.xlsx', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-xlsx', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(storage.save).toHaveBeenCalledWith(po.storageKey, expect.any(Buffer), 'text/csv')

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBe('A1')
  })

  it('fails cleanly when the purchase order row has no storageKey', async () => {
    const workspace = await seedWorkspace(`${prefix}po-nokey@example.com`, prefix)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-3', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('storageKey')
  })

  it('re-running parse for the same PO replaces line items rather than duplicating them', async () => {
    const workspace = await seedWorkspace(`${prefix}po-rerun@example.com`, prefix)
    const po = await seedPo(['sku,qty', 'A1,10'].join('\n'), workspace.id)

    await processor.handleParse({ id: 'job-4a', data: { kind: 'purchase_order', id: po.id } } as any)

    const csvPath2 = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath2, ['sku,qty', 'A1,10'].join('\n'))
    storage.getToTempFile.mockResolvedValue(csvPath2)
    await processor.handleParse({ id: 'job-4b', data: { kind: 'purchase_order', id: po.id } } as any)

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(1)
  })
})
