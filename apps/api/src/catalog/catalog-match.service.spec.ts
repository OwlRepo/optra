import { eq, like } from 'drizzle-orm'
import {
  catalogItems,
  catalogMatches,
  catalogs,
  db,
  pool,
  poLineItems,
  purchaseOrders,
  users,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { CatalogMatchService } from './catalog-match.service'
import { StorageService } from '../storage/storage.service'
import { CatalogExtractionService } from './catalog-extraction.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(catalogMatches).where(eq(catalogMatches.workspaceId, membership.workspaceId))
      await db.delete(catalogItems).where(eq(catalogItems.workspaceId, membership.workspaceId))
      await db.delete(catalogs).where(eq(catalogs.workspaceId, membership.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
      await db.delete(poLineItems).where(eq(poLineItems.workspaceId, membership.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
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

async function seedPoLineItem(workspaceId: string, sku: string, description: string) {
  const [po] = await db.insert(purchaseOrders).values({ workspaceId, name: 'po.csv', status: 'done' }).returning()
  const [item] = await db
    .insert(poLineItems)
    .values({ workspaceId, purchaseOrderId: po.id, sku, description })
    .returning()
  return item
}

async function seedVendorWithCatalogItem(
  workspaceId: string,
  vendorName: string,
  item: { sku: string; description: string; photoStorageKey?: string },
) {
  const [vendor] = await db.insert(vendors).values({ workspaceId, name: vendorName }).returning()
  const [catalog] = await db
    .insert(catalogs)
    .values({ workspaceId, vendorId: vendor.id, name: 'catalog.pdf', status: 'done' })
    .returning()
  const [catalogItem] = await db
    .insert(catalogItems)
    .values({
      workspaceId,
      catalogId: catalog.id,
      sku: item.sku,
      description: item.description,
      photoStorageKey: item.photoStorageKey ?? null,
    })
    .returning()
  return { vendor, catalog, catalogItem }
}

describe('CatalogMatchService', () => {
  let service: CatalogMatchService
  let storage: { getBuffer: jest.Mock }
  let extraction: { compare: jest.Mock }
  const prefix = `catalog-match-spec-${Date.now()}-`

  beforeEach(() => {
    storage = { getBuffer: jest.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])) }
    extraction = { compare: jest.fn().mockResolvedValue({ isMatch: true, score: 0.9, reason: 'Same widget.' }) }
    service = new CatalogMatchService(storage as unknown as StorageService, extraction as unknown as CatalogExtractionService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('searches all vendors (sourcing) and persists judged matches', async () => {
    const workspace = await seedWorkspace(`${prefix}sourcing@example.com`, 'Sourcing WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    const { catalogItem, vendor } = await seedVendorWithCatalogItem(workspace.id, 'Acme', {
      sku: 'A1',
      description: 'Widget',
      photoStorageKey: 'k/photo.png',
    })

    const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({
      matchType: 'sourcing',
      catalogItemId: catalogItem.id,
      vendorId: vendor.id,
      isMatch: true,
      reason: 'Same widget.',
    })
    expect(storage.getBuffer).toHaveBeenCalledWith('k/photo.png')
    expect(extraction.compare).toHaveBeenCalledWith(
      expect.objectContaining({ candidateImageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }),
    )
  })

  it('falls back to text-only judgment when a candidate has no photo', async () => {
    const workspace = await seedWorkspace(`${prefix}nophoto@example.com`, 'No Photo WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(storage.getBuffer).not.toHaveBeenCalled()
    expect(extraction.compare).toHaveBeenCalledWith(expect.objectContaining({ candidateImageBase64: null }))
  })

  it('scopes to one vendor (compliance) and excludes other vendors', async () => {
    const workspace = await seedWorkspace(`${prefix}compliance@example.com`, 'Compliance WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    const { vendor: vendorA } = await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
    await seedVendorWithCatalogItem(workspace.id, 'Other Vendor', { sku: 'A1', description: 'Widget' })

    const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id, vendorId: vendorA.id })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ matchType: 'compliance', vendorId: vendorA.id })
  })

  it('re-searching replaces prior matches rather than duplicating them', async () => {
    const workspace = await seedWorkspace(`${prefix}rerun@example.com`, 'Rerun WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    const rows = await db.select().from(catalogMatches).where(eq(catalogMatches.queryPoLineItemId, poItem.id))
    expect(rows).toHaveLength(1)
  })

  it('rejects a query line item from another workspace', async () => {
    const mine = await seedWorkspace(`${prefix}isolation-mine@example.com`, 'Isolation Mine')
    const other = await seedWorkspace(`${prefix}isolation-other@example.com`, 'Isolation Other')
    const otherItem = await seedPoLineItem(other.id, 'A1', 'Widget')

    await expect(service.search(mine.id, { purchaseOrderLineItemId: otherItem.id })).rejects.toThrow(
      'Purchase order line item not found',
    )
  })

  it('lists and dismisses matches, excluding dismissed from the open filter', async () => {
    const workspace = await seedWorkspace(`${prefix}dismiss@example.com`, 'Dismiss WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    const [match] = await service.listMatches(workspace.id, {})
    expect(match.status).toBe('open')

    await service.dismissMatch(workspace.id, match.id, workspace.ownerId)

    const open = await service.listMatches(workspace.id, { status: 'open' })
    const dismissed = await service.listMatches(workspace.id, { status: 'dismissed' })
    expect(open).toHaveLength(0)
    expect(dismissed).toHaveLength(1)
  })
})
