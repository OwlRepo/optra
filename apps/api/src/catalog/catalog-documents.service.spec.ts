import { eq, like } from 'drizzle-orm'
import { catalogItems, catalogs, db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { CatalogDocumentsService } from './catalog-documents.service'
import { StorageService } from '../storage/storage.service'
import { CatalogParseService } from './catalog-parse.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(catalogItems).where(eq(catalogItems.workspaceId, membership.workspaceId))
      await db.delete(catalogs).where(eq(catalogs.workspaceId, membership.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceAndVendor(email: string, name: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [vendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: `${name} Vendor` }).returning()
  return { workspace, vendor }
}

describe('CatalogDocumentsService', () => {
  let service: CatalogDocumentsService
  let storage: { save: jest.Mock; delete: jest.Mock }
  let parse: { queueDoc: jest.Mock }
  const prefix = `catalog-documents-spec-${Date.now()}-`

  beforeEach(() => {
    storage = { save: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) }
    parse = { queueDoc: jest.fn().mockResolvedValue({ queued: true }) }
    service = new CatalogDocumentsService(storage as unknown as StorageService, parse as unknown as CatalogParseService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('uploads a catalog file, saves it to storage, and enqueues parsing', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}upload@example.com`, 'Catalog Upload')
    const file = { originalname: 'catalog.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') } as Express.Multer.File

    const result = await service.upload(workspace.id, vendor.id, file)

    expect(result.name).toBe('catalog.pdf')
    expect(result.status).toBe('pending')
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringContaining(`${workspace.id}/catalogs/${result.id}/`),
      file.buffer,
      'application/pdf',
    )
    expect(parse.queueDoc).toHaveBeenCalledWith(result.id)

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, result.id))
    expect(row.workspaceId).toBe(workspace.id)
    expect(row.vendorId).toBe(vendor.id)
    expect(row.sourceKind).toBe('upload')
    expect(row.storageKey).toContain(`${workspace.id}/catalogs/${result.id}/`)
  })

  it('rejects uploading to a vendor from another workspace', async () => {
    const mine = await seedWorkspaceAndVendor(`${prefix}isolation-mine@example.com`, 'Catalog Isolation Mine')
    const other = await seedWorkspaceAndVendor(`${prefix}isolation-other@example.com`, 'Catalog Isolation Other')
    const file = { originalname: 'catalog.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x') } as Express.Multer.File

    await expect(service.upload(mine.workspace.id, other.vendor.id, file)).rejects.toThrow('Vendor not found')
  })

  it('marks the catalog failed when enqueueing parse throws', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}enqueue-fail@example.com`, 'Catalog Enqueue Fail')
    parse.queueDoc.mockRejectedValue(new Error('queue down'))
    const file = { originalname: 'catalog.csv', mimetype: 'text/csv', buffer: Buffer.from('sku,description\nA,Widget') } as Express.Multer.File

    await expect(service.upload(workspace.id, vendor.id, file)).rejects.toThrow('queue down')

    const [row] = await db.select().from(catalogs).where(eq(catalogs.workspaceId, workspace.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('lists catalogs for a vendor newest-first, excluding other vendors', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}list-catalogs@example.com`, 'List Catalogs')
    const other = await seedWorkspaceAndVendor(`${prefix}list-catalogs-other@example.com`, 'List Catalogs Other')
    await db.insert(catalogs).values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'a.pdf', status: 'done' })
    await db.insert(catalogs).values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'b.pdf', status: 'pending' })
    await db.insert(catalogs).values({ workspaceId: other.workspace.id, vendorId: other.vendor.id, name: 'c.pdf' })

    const items = await service.listCatalogs(workspace.id, vendor.id)

    expect(items.map((item) => item.name)).toEqual(['b.pdf', 'a.pdf'])
  })

  it('rejects listing catalogs for a vendor from another workspace', async () => {
    const mine = await seedWorkspaceAndVendor(`${prefix}list-isolation-mine@example.com`, 'List Isolation Mine')
    const other = await seedWorkspaceAndVendor(`${prefix}list-isolation-other@example.com`, 'List Isolation Other')

    await expect(service.listCatalogs(mine.workspace.id, other.vendor.id)).rejects.toThrow('Vendor not found')
  })

  it('lists items for a catalog in line-number order', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}list-items@example.com`, 'List Items')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'a.pdf', status: 'done' })
      .returning()
    await db.insert(catalogItems).values({ workspaceId: workspace.id, catalogId: catalog.id, lineNumber: 2, sku: 'B2' })
    await db.insert(catalogItems).values({ workspaceId: workspace.id, catalogId: catalog.id, lineNumber: 1, sku: 'A1' })

    const items = await service.listItems(workspace.id, vendor.id, catalog.id)

    expect(items.map((item) => item.sku)).toEqual(['A1', 'B2'])
  })

  it('rejects listing items for a catalog from another workspace', async () => {
    const mine = await seedWorkspaceAndVendor(`${prefix}list-items-isolation-mine@example.com`, 'List Items Isolation Mine')
    const other = await seedWorkspaceAndVendor(`${prefix}list-items-isolation-other@example.com`, 'List Items Isolation Other')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: other.workspace.id, vendorId: other.vendor.id, name: 'a.pdf', status: 'done' })
      .returning()

    await expect(service.listItems(mine.workspace.id, mine.vendor.id, catalog.id)).rejects.toThrow('Catalog not found')
  })
})
