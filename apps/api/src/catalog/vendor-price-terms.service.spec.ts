import { asc, eq, like } from 'drizzle-orm'
import { db, pool, users, vendorPriceTerms, vendors, workspaceMembers, workspaces } from '@repo/db'
import { VendorPriceTermsService } from './vendor-price-terms.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(vendorPriceTerms).where(eq(vendorPriceTerms.workspaceId, membership.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

describe('VendorPriceTermsService', () => {
  let service: VendorPriceTermsService
  const prefix = `vendor-price-terms-spec-${Date.now()}-`

  beforeEach(() => {
    service = new VendorPriceTermsService()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedVendor(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    const [vendor] = await db
      .insert(vendors)
      .values({ workspaceId: workspace.id, name: `${name} Supplies` })
      .returning()
    return { user, workspace, vendor }
  }

  const term = (overrides: Record<string, unknown> = {}) =>
    ({
      sku: 'LAP-9001',
      unitPrice: '1250.00',
      currency: 'usd',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      sourceReference: 'MSA-2026-04 section 3',
      ...overrides,
    }) as never

  const termsFor = (vendorId: string) =>
    db
      .select()
      .from(vendorPriceTerms)
      .where(eq(vendorPriceTerms.vendorId, vendorId))
      .orderBy(asc(vendorPriceTerms.effectiveFrom))

  it('records the agreed price with every column a later comparison will read', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}create@example.com`, 'Create')

    await service.create(workspace.id, vendor.id, term({ uom: 'each' }), user.id)

    const [row] = await termsFor(vendor.id)
    expect(row.sku).toBe('LAP-9001')
    // The display SKU is kept exactly as written; the match key is folded,
    // because the comparison engine's own key is `sku::<lower>`.
    expect(row.skuKey).toBe('lap-9001')
    expect(row.uom).toBe('each')
    expect(Number(row.unitPrice)).toBe(1250)
    // Uppercased in the service, not by a @Transform: the global ValidationPipe
    // runs without `transform`, so a decorator would never fire.
    expect(row.currency).toBe('USD')
    expect(row.effectiveTo).toBeNull()
    expect(row.supersedesId).toBeNull()
    expect(row.createdBy).toBe(user.id)
    expect(row.sourceReference).toBe('MSA-2026-04 section 3')
  })

  it('folds the match key but keeps the SKU a human will read', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}fold@example.com`, 'Fold')

    await service.create(workspace.id, vendor.id, term({ sku: '  Lap-9001  ' }), user.id)

    const [row] = await termsFor(vendor.id)
    expect(row.sku).toBe('Lap-9001')
    expect(row.skuKey).toBe('lap-9001')
  })

  // The heart of it: a new price does not sit beside the old one, it ends it.
  it('closes the previous open term and links the chain when a new price arrives', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}supersede@example.com`, 'Supersede')
    await service.create(workspace.id, vendor.id, term(), user.id)

    await service.create(
      workspace.id,
      vendor.id,
      term({ unitPrice: '1310.00', effectiveFrom: '2026-07-01T00:00:00.000Z' }),
      user.id,
    )

    const rows = await termsFor(vendor.id)
    expect(rows).toHaveLength(2)
    const [older, newer] = rows
    // Half-open [from, to): the old window ends exactly where the new one
    // starts, so no instant is covered by both and none is covered by neither.
    expect(older.effectiveTo?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(newer.effectiveFrom.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(newer.effectiveTo).toBeNull()
    expect(newer.supersedesId).toBe(older.id)
    // The old row is history, not a correction — its price is untouched.
    expect(Number(older.unitPrice)).toBe(1250)
  })

  // The invariant the database cannot hold: drizzle-kit 0.20 drops `.where()`
  // from a unique index, so a partial unique index is unavailable and a full
  // one would reject exactly the superseded rows above.
  it('leaves exactly one open-ended term however many prices are recorded', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}oneopen@example.com`, 'One Open')

    await service.create(workspace.id, vendor.id, term({ effectiveFrom: '2026-01-01T00:00:00.000Z' }), user.id)
    await service.create(workspace.id, vendor.id, term({ effectiveFrom: '2026-04-01T00:00:00.000Z' }), user.id)
    await service.create(workspace.id, vendor.id, term({ effectiveFrom: '2026-09-01T00:00:00.000Z' }), user.id)

    const rows = await termsFor(vendor.id)
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.effectiveTo === null)).toHaveLength(1)
  })

  // A different unit, or a different currency, is a different agreement —
  // not a replacement for one. POLICY v1 #4: units are never converted.
  it('does not supersede a term stated in another unit or another currency', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}otherunit@example.com`, 'Other Unit')
    await service.create(workspace.id, vendor.id, term({ uom: 'each' }), user.id)

    await service.create(workspace.id, vendor.id, term({ uom: 'case', unitPrice: '11000.00' }), user.id)
    await service.create(workspace.id, vendor.id, term({ uom: 'each', currency: 'eur' }), user.id)

    const rows = await termsFor(vendor.id)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.effectiveTo === null)).toBe(true)
  })

  it('refuses a vendor belonging to another workspace, and writes nothing', async () => {
    const mine = await seedVendor(`${prefix}mine@example.com`, 'Mine')
    const theirs = await seedVendor(`${prefix}theirs@example.com`, 'Theirs')

    await expect(service.create(mine.workspace.id, theirs.vendor.id, term(), mine.user.id)).rejects.toThrow()

    expect(await termsFor(theirs.vendor.id)).toHaveLength(0)
    expect(await termsFor(mine.vendor.id)).toHaveLength(0)
  })

  it('lists a vendor price terms newest window first', async () => {
    const { user, workspace, vendor } = await seedVendor(`${prefix}list@example.com`, 'List')
    await service.create(workspace.id, vendor.id, term({ effectiveFrom: '2026-01-01T00:00:00.000Z' }), user.id)
    await service.create(workspace.id, vendor.id, term({ effectiveFrom: '2026-06-01T00:00:00.000Z' }), user.id)

    const listed = await service.list(workspace.id, vendor.id)

    expect(listed).toHaveLength(2)
    expect(listed[0].effectiveFrom.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(listed[0].effectiveTo).toBeNull()
  })

  it('never shows another workspace price terms', async () => {
    const mine = await seedVendor(`${prefix}iso-mine@example.com`, 'Iso Mine')
    const theirs = await seedVendor(`${prefix}iso-theirs@example.com`, 'Iso Theirs')
    await service.create(theirs.workspace.id, theirs.vendor.id, term(), theirs.user.id)

    await expect(service.list(mine.workspace.id, theirs.vendor.id)).rejects.toThrow()
  })
})
