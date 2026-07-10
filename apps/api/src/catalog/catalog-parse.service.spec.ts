import { eq, like } from 'drizzle-orm'
import { catalogs, db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { CatalogParseService } from './catalog-parse.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
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

describe('CatalogParseService', () => {
  let service: CatalogParseService
  let queue: { add: jest.Mock; on: jest.Mock; getJob: jest.Mock }
  const prefix = `catalog-parse-spec-${Date.now()}-`

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn(), getJob: jest.fn().mockResolvedValue(null) }
    service = new CatalogParseService(queue as any)
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('enqueues a catalog with a deterministic jobId and pending status', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}enqueue@example.com`, 'Catalog Enqueue')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.pdf' })
      .returning()

    const result = await service.queueDoc(catalog.id)

    expect(result).toEqual({ queued: true, id: catalog.id, jobId: `catalog-parse:${catalog.id}` })
    expect(queue.add).toHaveBeenCalledWith(
      { id: catalog.id },
      expect.objectContaining({ jobId: `catalog-parse:${catalog.id}`, attempts: 3 }),
    )

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('pending')
    expect(row.queueJobId).toBe(`catalog-parse:${catalog.id}`)
  })

  it('marks the catalog failed when the queue add throws', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}fail@example.com`, 'Catalog Enqueue Fail')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.pdf' })
      .returning()
    queue.add.mockRejectedValue(new Error('queue down'))

    await expect(service.queueDoc(catalog.id)).rejects.toThrow('queue down')

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('reconcile marks a stale pending catalog failed when its Bull job is gone', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}stale@example.com`, 'Catalog Stale')
    const staleEnqueuedAt = new Date(Date.now() - 3 * 60_000)
    const [catalog] = await db
      .insert(catalogs)
      .values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        name: 'catalog.pdf',
        status: 'pending',
        queueJobId: 'catalog-parse:missing',
        enqueuedAt: staleEnqueuedAt,
      })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('reconciliation')
  })

  it('reconcile leaves a fresh pending row untouched', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}fresh@example.com`, 'Catalog Fresh')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.pdf', status: 'pending', enqueuedAt: new Date() })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('pending')
  })
})
