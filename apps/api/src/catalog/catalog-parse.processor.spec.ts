import { randomUUID } from 'crypto'
import { HttpException } from '@nestjs/common'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { catalogItems, catalogs, db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { CatalogParseProcessor } from './catalog-parse.processor'
import { CatalogExtractionService } from './catalog-extraction.service'
import { StorageObjectNotFoundError } from '../storage/storage.errors'
import { CatalogImageService } from './catalog-image.service'
import { CatalogParseService } from './catalog-parse.service'
import { StorageService } from '../storage/storage.service'

const mockRenderPdfToImages = jest.fn()

jest.mock('@repo/ai', () => ({
  renderPdfToImages: (...args: unknown[]) => mockRenderPdfToImages(...args),
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

describe('CatalogParseProcessor', () => {
  const prefix = `catalog-parse-proc-spec-${Date.now()}-`
  let dir: string
  let storage: { getToTempFile: jest.Mock; save: jest.Mock }
  let extraction: { extractFromImage: jest.Mock }
  let images: { fetchAndStore: jest.Mock }
  let parseService: { reconcile: jest.Mock }
  let processor: CatalogParseProcessor

  beforeEach(() => {
    jest.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'catalog-parse-proc-spec-'))
    storage = { getToTempFile: jest.fn(), save: jest.fn().mockResolvedValue(undefined) }
    extraction = { extractFromImage: jest.fn() }
    images = { fetchAndStore: jest.fn() }
    parseService = { reconcile: jest.fn().mockResolvedValue(undefined) }
    processor = new CatalogParseProcessor(
      storage as unknown as StorageService,
      extraction as unknown as CatalogExtractionService,
      images as unknown as CatalogImageService,
      parseService as unknown as CatalogParseService,
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedWorkspaceAndVendor(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    const [vendor] = await db.insert(vendors).values({ workspaceId: workspace.id, name: `${name} Vendor` }).returning()
    return { workspace, vendor }
  }

  async function seedCatalog(workspaceId: string, vendorId: string, name: string, fileContent: string) {
    const filePath = join(dir, `${randomUUID()}-${name}`)
    writeFileSync(filePath, fileContent)
    storage.getToTempFile.mockResolvedValue(filePath)

    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId, vendorId, name, storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    return catalog
  }

  it('parses a PDF catalog page-by-page, storing each page image and tagging items with sourcePageNumber', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}pdf@example.com`, 'Catalog PDF')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.pdf', 'fake pdf bytes')

    mockRenderPdfToImages.mockResolvedValue({
      pages: [Buffer.from([0x01]), Buffer.from([0x02])],
      total: 2,
      truncated: false,
    })
    extraction.extractFromImage
      .mockResolvedValueOnce({ items: [{ sku: 'A1', description: 'Widget', confidence: 0.9 }] })
      .mockResolvedValueOnce({ items: [{ sku: 'B2', description: 'Gadget', confidence: 0.8 }] })

    await processor.handleParse({ id: 'job-pdf', data: { id: catalog.id } } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)

    const items = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalog.id))
      .orderBy(catalogItems.lineNumber)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', sourcePageNumber: 1 })
    expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', sourcePageNumber: 2 })
    expect(items[0].photoStorageKey).not.toBe(items[1].photoStorageKey)
    expect(items[0].photoStorageKey).toContain(`${workspace.id}/catalogs/${catalog.id}/pages/`)

    // 2 page-image saves; no photo_url downloads on the PDF branch.
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(images.fetchAndStore).not.toHaveBeenCalled()
  })

  it('parses a CSV catalog, mapping sku/description and downloading photo_url', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}csv@example.com`, 'Catalog CSV')
    const csv = ['sku,description,photo_url', 'A1,Widget,https://vendor.example.com/a1.png'].join('\n')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)
    images.fetchAndStore.mockResolvedValue(`${workspace.id}/catalogs/${catalog.id}/images/a1.png`)

    await processor.handleParse({ id: 'job-csv', data: { id: catalog.id } } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(1)

    const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sku: 'A1',
      description: 'Widget',
      photoStorageKey: `${workspace.id}/catalogs/${catalog.id}/images/a1.png`,
      sourcePageNumber: null,
    })
    expect(images.fetchAndStore).toHaveBeenCalledWith(workspace.id, catalog.id, 'https://vendor.example.com/a1.png')
    expect(extraction.extractFromImage).not.toHaveBeenCalled()
  })

  it('parses an XLSX catalog in memory and never overwrites the stored original', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}xlsx@example.com`, 'Catalog XLSX')
    const worksheet = XLSX.utils.json_to_sheet([{ sku: 'A1', description: 'Widget' }])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const filePath = join(dir, `${randomUUID()}.xlsx`)
    writeFileSync(filePath, buffer)
    storage.getToTempFile.mockResolvedValue(filePath)

    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.xlsx', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-xlsx', data: { id: catalog.id } } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('done')
    expect(storage.save).not.toHaveBeenCalled()

    const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBe('A1')
  })

  it('fails cleanly when the catalog row has no storageKey', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}nokey@example.com`, 'Catalog No Key')
    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.csv', status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-nokey', data: { id: catalog.id } } as any)

    const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('storageKey')
  })

  it('re-running parse for the same catalog replaces items rather than duplicating them', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}rerun@example.com`, 'Catalog Rerun')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', 'sku,description\nA1,Widget')

    await processor.handleParse({ id: 'job-rerun-a', data: { id: catalog.id } } as any)

    const filePath2 = join(dir, `${randomUUID()}.csv`)
    writeFileSync(filePath2, 'sku,description\nA1,Widget')
    storage.getToTempFile.mockResolvedValue(filePath2)
    await processor.handleParse({ id: 'job-rerun-b', data: { id: catalog.id } } as any)

    const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
    expect(items).toHaveLength(1)
  })

  it('rethrows a transient failure before the last attempt so Bull retries it', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}transient@example.com`, 'Catalog Transient')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', 'sku,description\nA1,Widget')
    storage.getToTempFile.mockRejectedValue(new Error('socket hang up'))

    await expect(
      processor.handleParse({ id: 'job-t1', data: { id: catalog.id }, attemptsMade: 0, opts: { attempts: 3 } } as any),
    ).rejects.toThrow('socket hang up')

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('processing')
  })

  it('marks the catalog failed on the last transient attempt and still rethrows', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}transient-last@example.com`, 'Catalog Last')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', 'sku,description\nA1,Widget')
    storage.getToTempFile.mockRejectedValue(new Error('socket hang up'))

    await expect(
      processor.handleParse({ id: 'job-t3', data: { id: catalog.id }, attemptsMade: 2, opts: { attempts: 3 } } as any),
    ).rejects.toThrow('socket hang up')

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
  })

  it('fails a catalog whose stored file is gone at once, with a client-safe reason, without retrying', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}gone@example.com`, 'Catalog Gone')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', 'sku,description\nA1,Widget')
    storage.getToTempFile.mockRejectedValue(new StorageObjectNotFoundError('k/gone.csv'))

    await expect(
      processor.handleParse({ id: 'job-gone', data: { id: catalog.id }, attemptsMade: 0, opts: { attempts: 3 } } as any),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('The stored file is missing. Upload it again.')
  })

  it('fails an unreadable PDF catalog immediately without asking Bull to retry', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}bad-pdf@example.com`, 'Catalog Bad PDF')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.pdf', 'not really a pdf')
    mockRenderPdfToImages.mockRejectedValue(new Error('Invalid PDF structure'))

    await expect(
      processor.handleParse({ id: 'job-p1', data: { id: catalog.id }, attemptsMade: 0, opts: { attempts: 3 } } as any),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('Could not read this PDF')
  })

  it('runs queue reconciliation when the repeatable reconcile job fires', async () => {
    await processor.handleReconcile()

    expect(parseService.reconcile).toHaveBeenCalledTimes(1)
  })

  it('fails the catalog with the budget message instead of skipping pages when the budget is exhausted', async () => {
    const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}budget@example.com`, 'Catalog Budget')
    const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.pdf', 'fake pdf bytes')
    mockRenderPdfToImages.mockResolvedValue({ pages: [Buffer.from([0x01]), Buffer.from([0x02])], total: 2, truncated: false })
    extraction.extractFromImage.mockRejectedValue(new HttpException('Workspace monthly token budget reached', 402))

    await expect(
      processor.handleParse({ id: 'job-budget', data: { id: catalog.id }, attemptsMade: 0, opts: { attempts: 3 } } as any),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('Workspace monthly token budget reached')
    expect(extraction.extractFromImage).toHaveBeenCalledTimes(1)
    expect(extraction.extractFromImage).toHaveBeenCalledWith(expect.any(Buffer), workspace.id)
  })
})
