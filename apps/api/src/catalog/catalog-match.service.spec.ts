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
  let storage: { getObject: jest.Mock }
  let extraction: { compare: jest.Mock }
  const prefix = `catalog-match-spec-${Date.now()}-`

  beforeEach(() => {
    storage = {
      getObject: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' }),
    }
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
    expect(storage.getObject).toHaveBeenCalledWith('k/photo.png')
    expect(extraction.compare).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateImageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
        candidateImageContentType: 'image/png',
      }),
      workspace.id,
    )
  })

  it('falls back to text-only judgment when a candidate has no photo', async () => {
    const workspace = await seedWorkspace(`${prefix}nophoto@example.com`, 'No Photo WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(storage.getObject).not.toHaveBeenCalled()
    expect(extraction.compare).toHaveBeenCalledWith(expect.objectContaining({ candidateImageBase64: null }), workspace.id)
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

  it('keeps a dismissed match when the same line is searched again', async () => {
    const workspace = await seedWorkspace(`${prefix}keep-dismissed@example.com`, 'Keep Dismissed WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
    const [match] = await service.listMatches(workspace.id, {})
    await service.dismissMatch(workspace.id, match.id, workspace.ownerId)

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    const dismissed = await service.listMatches(workspace.id, { status: 'dismissed' })
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0].id).toBe(match.id)
  })

  it("leaves another vendor's sourcing matches alone when verifying one vendor", async () => {
    const workspace = await seedWorkspace(`${prefix}vendor-scope@example.com`, 'Vendor Scope WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    const { vendor: vendorA } = await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
    const { vendor: vendorB } = await seedVendorWithCatalogItem(workspace.id, 'Beta', { sku: 'A1', description: 'Widget' })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
    expect(await service.listMatches(workspace.id, {})).toHaveLength(2)

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id, vendorId: vendorA.id })

    const rows = await service.listMatches(workspace.id, {})
    // The point of the test: vendor B was never re-judged, so its sourcing
    // verdict must survive. Before the fix the delete ignored vendor and
    // matchType, so verifying A wiped B's row too.
    expect(rows.filter((r) => r.vendorId === vendorB.id)).toEqual([
      expect.objectContaining({ matchType: 'sourcing', status: 'open' }),
    ])
    // Vendor A keeps two rows on purpose, not by accident: `matchType` exists
    // to separate "found somewhere in our catalogs" (sourcing) from "this
    // vendor carries it" (compliance). A verify replaces only prior compliance
    // rows for that vendor, so the earlier sourcing verdict is left standing.
    expect(rows.filter((r) => r.vendorId === vendorA.id).map((r) => r.matchType).sort()).toEqual([
      'compliance',
      'sourcing',
    ])
  })

  it('rejects a vendor from another workspace instead of silently finding nothing', async () => {
    const mine = await seedWorkspace(`${prefix}vendor-iso-mine@example.com`, 'Vendor Iso Mine')
    const other = await seedWorkspace(`${prefix}vendor-iso-other@example.com`, 'Vendor Iso Other')
    const poItem = await seedPoLineItem(mine.id, 'A1', 'Widget')
    const { vendor: foreignVendor } = await seedVendorWithCatalogItem(other.id, 'Foreign', {
      sku: 'A1',
      description: 'Widget',
    })

    await expect(
      service.search(mine.id, { purchaseOrderLineItemId: poItem.id, vendorId: foreignVendor.id }),
    ).rejects.toThrow('Vendor not found')
    expect(extraction.compare).not.toHaveBeenCalled()
  })

  it('deletes nothing when a search finds no candidates', async () => {
    const workspace = await seedWorkspace(`${prefix}no-candidates@example.com`, 'No Candidates WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
    const [emptyVendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: 'Empty' }).returning()

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
    expect(await service.listMatches(workspace.id, {})).toHaveLength(1)

    const result = await service.search(workspace.id, {
      purchaseOrderLineItemId: poItem.id,
      vendorId: emptyVendor.id,
    })

    expect(result.matches).toHaveLength(0)
    expect(await service.listMatches(workspace.id, {})).toHaveLength(1)
  })

  it('treats % in a SKU as a literal, not a wildcard', async () => {
    const workspace = await seedWorkspace(`${prefix}wildcard@example.com`, 'Wildcard WS')
    const poItem = await seedPoLineItem(workspace.id, 'A%1', 'Widget')
    const { catalogItem: literal } = await seedVendorWithCatalogItem(workspace.id, 'Acme', {
      sku: 'A%1',
      description: 'Widget',
    })
    await seedVendorWithCatalogItem(workspace.id, 'Beta', { sku: 'AZZZ1', description: 'Unrelated part' })

    const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].catalogItemId).toBe(literal.id)
  })

  it('judges nothing when the query line has no sku and no description', async () => {
    const workspace = await seedWorkspace(`${prefix}blank-query@example.com`, 'Blank Query WS')
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
      .returning()
    const [poItem] = await db
      .insert(poLineItems)
      .values({ workspaceId: workspace.id, purchaseOrderId: po.id, sku: null, description: null })
      .returning()
    await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })

    const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(result.matches).toHaveLength(0)
    expect(extraction.compare).not.toHaveBeenCalled()
  })

  it('judges candidates at most three at a time', async () => {
    const workspace = await seedWorkspace(`${prefix}concurrency@example.com`, 'Concurrency WS')
    const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
    for (let i = 0; i < 6; i++) {
      await seedVendorWithCatalogItem(workspace.id, `Vendor ${i}`, { sku: 'A1', description: 'Widget' })
    }
    let inFlight = 0
    let maxInFlight = 0
    extraction.compare.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return { isMatch: true, score: 0.9, reason: 'Same widget.' }
    })

    await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

    expect(extraction.compare).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })
})
