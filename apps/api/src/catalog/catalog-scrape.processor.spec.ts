import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { eq, like } from 'drizzle-orm'
import { catalogItems, catalogs, db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { CatalogScrapeProcessor } from './catalog-scrape.processor'
import { CatalogImageService } from './catalog-image.service'

const mockCrawlSite = jest.fn()
const mockExtractProductImages = jest.fn()

jest.mock('@repo/ai', () => ({
  crawlSite: (...args: unknown[]) => mockCrawlSite(...args),
  extractProductImages: (...args: unknown[]) => mockExtractProductImages(...args),
}))

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

async function seedCatalog(emailPrefix: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${emailPrefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Catalog Scrape Processor WS ${Date.now()}`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  const [vendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: `Vendor ${Date.now()}` }).returning()
  const [catalog] = await db
    .insert(catalogs)
    .values({
      workspaceId: workspace.id,
      vendorId: vendor.id,
      name: 'https://vendor.example.com/catalog',
      sourceKind: 'scrape',
      seedUrl: 'https://vendor.example.com/catalog',
      status: 'pending',
    })
    .returning()

  return { workspace, vendor, catalog }
}

describe('CatalogScrapeProcessor', () => {
  let processor: CatalogScrapeProcessor
  let images: { fetchAndStore: jest.Mock }
  const prefix = `catalog-scrape-processor-spec-${Date.now()}-`

  beforeAll(async () => {
    images = { fetchAndStore: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogScrapeProcessor,
        { provide: CatalogImageService, useValue: images },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('CrawlerTest/1.0') } },
      ],
    }).compile()

    processor = moduleRef.get(CatalogScrapeProcessor)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('extracts product images per page, downloads them, and inserts catalog items', async () => {
    const { workspace, catalog } = await seedCatalog(prefix)
    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const page = { url: 'https://vendor.example.com/catalog/a', title: 'Page A', content: 'A', html: '<html>a</html>' }
      await options?.onPage?.(page, { pagesFound: 1, pagesVisited: 1, pagesQueued: 1, maxPages: 10 })
      return [page]
    })
    mockExtractProductImages.mockReturnValue([
      { url: 'https://vendor.example.com/a1.png', alt: 'Widget A1' },
      { url: 'https://vendor.example.com/a2.png', alt: 'Widget A2' },
    ])
    images.fetchAndStore
      .mockResolvedValueOnce(`${workspace.id}/catalogs/${catalog.id}/images/a1.png`)
      .mockResolvedValueOnce(`${workspace.id}/catalogs/${catalog.id}/images/a2.png`)

    await processor.handleScrape({
      id: 'job-1',
      data: { id: catalog.id, workspaceId: workspace.id, vendorId: catalog.vendorId, seedUrl: catalog.seedUrl, maxDepth: 3, maxPages: 500 },
    } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(updated.pagesFound).toBe(1)
    expect(updated.pagesSucceeded).toBe(1)
    expect(updated.pagesFailed).toBe(0)
    expect(updated.rowCount).toBe(2)

    const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.photoStorageKey).sort()).toEqual(
      [`${workspace.id}/catalogs/${catalog.id}/images/a1.png`, `${workspace.id}/catalogs/${catalog.id}/images/a2.png`].sort(),
    )
    expect(items[0].sku).toBeNull()
  })

  it('skips images that fail to download without failing the page', async () => {
    const { workspace, catalog } = await seedCatalog(`${prefix}skip-`)
    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const page = { url: 'https://vendor.example.com/catalog/a', title: 'Page A', content: 'A', html: '<html>a</html>' }
      await options?.onPage?.(page, { pagesFound: 1, pagesVisited: 1, pagesQueued: 1, maxPages: 10 })
      return [page]
    })
    mockExtractProductImages.mockReturnValue([{ url: 'https://vendor.example.com/blocked.png', alt: 'Blocked' }])
    images.fetchAndStore.mockResolvedValueOnce(null)

    await processor.handleScrape({
      id: 'job-2',
      data: { id: catalog.id, workspaceId: workspace.id, vendorId: catalog.vendorId, seedUrl: catalog.seedUrl, maxDepth: 3, maxPages: 500 },
    } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(updated.pagesSucceeded).toBe(1)
    expect(updated.rowCount).toBe(0)

    const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
    expect(items).toHaveLength(0)
  })

  it('counts a per-page failure without aborting the crawl', async () => {
    const { workspace, catalog } = await seedCatalog(`${prefix}pagefail-`)
    mockCrawlSite.mockImplementationOnce(async (_url: string, options?: { onPage?: (...args: any[]) => Promise<void> }) => {
      const pageA = { url: 'https://vendor.example.com/catalog/a', title: 'Page A', content: 'A', html: '<html>a</html>' }
      const pageB = { url: 'https://vendor.example.com/catalog/b', title: 'Page B', content: 'B', html: '<html>b</html>' }
      await options?.onPage?.(pageA, { pagesFound: 1, pagesVisited: 1, pagesQueued: 2, maxPages: 10 })
      await options?.onPage?.(pageB, { pagesFound: 2, pagesVisited: 2, pagesQueued: 2, maxPages: 10 })
      return [pageA, pageB]
    })
    mockExtractProductImages
      .mockImplementationOnce(() => {
        throw new Error('malformed html')
      })
      .mockReturnValueOnce([])

    await processor.handleScrape({
      id: 'job-3',
      data: { id: catalog.id, workspaceId: workspace.id, vendorId: catalog.vendorId, seedUrl: catalog.seedUrl, maxDepth: 3, maxPages: 500 },
    } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(updated.pagesFound).toBe(2)
    expect(updated.pagesSucceeded).toBe(1)
    expect(updated.pagesFailed).toBe(1)
  })

  it('marks the catalog failed when crawlSite throws', async () => {
    const { workspace, catalog } = await seedCatalog(`${prefix}crawlfail-`)
    mockCrawlSite.mockRejectedValue(new Error('crawl exploded'))

    await processor.handleScrape({
      id: 'job-4',
      data: { id: catalog.id, workspaceId: workspace.id, vendorId: catalog.vendorId, seedUrl: catalog.seedUrl, maxDepth: 3, maxPages: 500 },
    } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('crawl exploded')
  })
})
