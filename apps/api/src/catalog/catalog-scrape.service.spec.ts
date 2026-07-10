import { BadRequestException, NotFoundException } from '@nestjs/common'
import { eq, like } from 'drizzle-orm'
import { catalogs, db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { CatalogScrapeService } from './catalog-scrape.service'
import { assertPublicUrl } from '@repo/ai'

jest.mock('@repo/ai', () => ({
  assertPublicUrl: jest.fn(),
}))

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

describe('CatalogScrapeService', () => {
  let service: CatalogScrapeService
  let queue: { add: jest.Mock; on: jest.Mock; getJob: jest.Mock }
  const prefix = `catalog-scrape-spec-${Date.now()}-`

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn(), getJob: jest.fn().mockResolvedValue(null) }
    service = new CatalogScrapeService(queue as any)
    ;(assertPublicUrl as jest.Mock).mockReset().mockResolvedValue(undefined)
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('enqueues a scrape catalog with a deterministic jobId and pending status', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}enqueue@example.com`, 'Scrape Enqueue')

    const result = await service.startScrape(workspace.id, vendor.id, { seedUrl: 'https://vendor.example.com/catalog' })

    expect(result.status).toBe('pending')
    expect(queue.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.id, seedUrl: 'https://vendor.example.com/catalog' }),
      expect.objectContaining({ jobId: `catalog-scrape:${result.id}`, attempts: 1 }),
    )

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, result.id))
    expect(row.sourceKind).toBe('scrape')
    expect(row.seedUrl).toBe('https://vendor.example.com/catalog')
    expect(row.queueJobId).toBe(`catalog-scrape:${result.id}`)
  })

  it('rejects a seedUrl assertPublicUrl blocks', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}blocked@example.com`, 'Scrape Blocked')
    ;(assertPublicUrl as jest.Mock).mockRejectedValue(new Error('Blocked non-public URL'))

    await expect(
      service.startScrape(workspace.id, vendor.id, { seedUrl: 'http://169.254.169.254/catalog' }),
    ).rejects.toThrow(BadRequestException)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('rejects scraping into a vendor from another workspace', async () => {
    const mine = await seedWorkspaceAndVendor(`${prefix}isolation-mine@example.com`, 'Scrape Isolation Mine')
    const other = await seedWorkspaceAndVendor(`${prefix}isolation-other@example.com`, 'Scrape Isolation Other')

    await expect(
      service.startScrape(mine.workspace.id, other.vendor.id, { seedUrl: 'https://vendor.example.com/catalog' }),
    ).rejects.toThrow(NotFoundException)
  })

  it('marks the catalog failed when the queue add throws', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}fail@example.com`, 'Scrape Enqueue Fail')
    queue.add.mockRejectedValue(new Error('queue down'))

    await expect(
      service.startScrape(workspace.id, vendor.id, { seedUrl: 'https://vendor.example.com/catalog' }),
    ).rejects.toThrow('queue down')

    const [row] = await db.select().from(catalogs).where(eq(catalogs.workspaceId, workspace.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('reconcile marks an idle processing scrape catalog failed when its heartbeat is stale', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}idle@example.com`, 'Scrape Idle')
    const staleHeartbeat = new Date(Date.now() - 6 * 60_000)
    const [catalog] = await db
      .insert(catalogs)
      .values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        name: 'https://vendor.example.com/catalog',
        sourceKind: 'scrape',
        seedUrl: 'https://vendor.example.com/catalog',
        status: 'processing',
        queueJobId: 'catalog-scrape:live',
        processingStartedAt: staleHeartbeat,
        lastProgressAt: staleHeartbeat,
      })
      .returning()
    queue.getJob.mockResolvedValue({ id: 'live-job' })

    await service.reconcile()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('heartbeat')
  })

  it('reconcile marks a stale pending scrape catalog failed when its Bull job is gone', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}stale@example.com`, 'Scrape Stale')
    const staleEnqueuedAt = new Date(Date.now() - 3 * 60_000)
    const [catalog] = await db
      .insert(catalogs)
      .values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        name: 'https://vendor.example.com/catalog',
        sourceKind: 'scrape',
        seedUrl: 'https://vendor.example.com/catalog',
        status: 'pending',
        queueJobId: 'catalog-scrape:missing',
        enqueuedAt: staleEnqueuedAt,
      })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('reconciliation')
  })

  it('reconcile ignores non-scrape (upload) catalogs', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}upload@example.com`, 'Scrape Ignores Upload')
    const staleEnqueuedAt = new Date(Date.now() - 3 * 60_000)
    const [catalog] = await db
      .insert(catalogs)
      .values({
        workspaceId: workspace.id,
        vendorId: vendor.id,
        name: 'catalog.pdf',
        sourceKind: 'upload',
        status: 'pending',
        queueJobId: 'catalog-parse:missing',
        enqueuedAt: staleEnqueuedAt,
      })
      .returning()

    await service.reconcile()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('pending')
  })
})
