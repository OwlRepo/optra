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
  // The real limiter, loaded from its own file so the rest of @repo/ai stays mocked.
  createLimit: (concurrency: number) =>
    jest.requireActual('../../../../packages/ai/src/web/limit').createLimit(concurrency),
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
  describe('real-world catalogs (launch hardening)', () => {
    it('edge: a semicolon-delimited catalog with extra columns parses every item', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}semicolon@example.com`, 'Catalog Semicolon')
      const csv = [
        'Item Code;Item Name;Pack Size;Unit Price',
        'A1;Widget;10;1,50',
        'B2;Gadget;5;12,00',
        'C3;Gizmo, large;1;99,99',
      ].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)

      await processor.handleParse({ id: 'job-semicolon', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.lineNumber, item.sku, item.description])).toEqual([
        [1, 'A1', 'Widget'],
        [2, 'B2', 'Gadget'],
        [3, 'C3', 'Gizmo, large'],
      ])
      expect(items[0].rawRow).toEqual({ 'Item Code': 'A1', 'Item Name': 'Widget', 'Pack Size': '10', 'Unit Price': '1,50' })
      expect(images.fetchAndStore).not.toHaveBeenCalled()
    })

    it('edge: a UTF-8 byte-order mark before the header still maps the sku column', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}bom@example.com`, 'Catalog BOM')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', '﻿sku,description\nA1,Widget\n')

      await processor.handleParse({ id: 'job-bom', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(1)

      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget' })
      expect(items[0].rawRow).toEqual({ sku: 'A1', description: 'Widget' })
    })

    it('edge: an XLSX catalog is read from its first sheet only', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}xlsx-sheets@example.com`, 'Catalog Sheets')
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ sku: 'A1', description: 'Widget' }]), 'Catalog')
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ sku: 'Z9', description: 'Archived item' }]), 'Archive')
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      const filePath = join(dir, `${randomUUID()}.xlsx`)
      writeFileSync(filePath, buffer)
      storage.getToTempFile.mockResolvedValue(filePath)

      const [catalog] = await db
        .insert(catalogs)
        .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.xlsx', storageKey: `k/${randomUUID()}`, status: 'pending' })
        .returning()

      await processor.handleParse({ id: 'job-xlsx-sheets', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(1)

      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items.map((item) => item.sku)).toEqual(['A1'])
    })

    it('edge: a row whose photo cannot be fetched is kept with no photo', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}photo-null@example.com`, 'Catalog Photo Null')
      const csv = [
        'sku,description,photo_url',
        'A1,Widget,https://vendor.example.com/a1.png',
        'B2,Gadget,https://vendor.example.com/b2.png',
      ].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)
      images.fetchAndStore
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(`${workspace.id}/catalogs/${catalog.id}/images/b2.png`)

      await processor.handleParse({ id: 'job-photo-null', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items[0]).toMatchObject({ lineNumber: 1, sku: 'A1', photoStorageKey: null })
      expect(items[1]).toMatchObject({
        lineNumber: 2,
        sku: 'B2',
        photoStorageKey: `${workspace.id}/catalogs/${catalog.id}/images/b2.png`,
      })
      expect(images.fetchAndStore).toHaveBeenNthCalledWith(1, workspace.id, catalog.id, 'https://vendor.example.com/a1.png')
    })

    it('happy: a CSV catalog with sku, description and photo url stores its items in file order, numbered from 1', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}order@example.com`, 'Catalog Order')
      const urls = [
        'https://vendor.example.com/a1.png',
        'https://vendor.example.com/b2.png',
        'https://vendor.example.com/c3.png',
      ]
      const csv = ['SKU,Description,Photo URL', `A1,Widget,${urls[0]}`, `B2,Gadget,${urls[1]}`, `C3,Gizmo,${urls[2]}`].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)
      images.fetchAndStore.mockImplementation(
        async (workspaceId: string, catalogId: string, url: string) =>
          `${workspaceId}/catalogs/${catalogId}/images/${url.split('/').pop()}`,
      )

      await processor.handleParse({ id: 'job-order', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      const base = `${workspace.id}/catalogs/${catalog.id}/images`
      expect(items.map((item) => [item.lineNumber, item.sku, item.description, item.photoStorageKey])).toEqual([
        [1, 'A1', 'Widget', `${base}/a1.png`],
        [2, 'B2', 'Gadget', `${base}/b2.png`],
        [3, 'C3', 'Gizmo', `${base}/c3.png`],
      ])
      expect(images.fetchAndStore.mock.calls.map((call) => call[2])).toEqual(urls)
    })
  })

  // B7. Photos were fetched one at a time, 20 s each at worst, inside a
  // 5-minute Bull attempt; a catalog whose photo host hangs outlived the
  // attempt, Bull started a retry beside the still-running one, and both
  // rewrote the items. Photo fetching is now bounded in both concurrency and
  // total time, so the job always finishes inside its attempt.
  describe('photo fetching budget (B7)', () => {
    function csvWithPhotos(count: number) {
      const lines = ['sku,description,photo_url']
      for (let i = 1; i <= count; i++) lines.push(`P${i},Item ${i},https://vendor.example.com/p${i}.png`)
      return lines.join('\n')
    }

    it('edge: fetches several photos at once, never more than four', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b7-concurrency@example.com`, 'B7 Concurrency')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csvWithPhotos(10))
      let inFlight = 0
      let maxInFlight = 0
      images.fetchAndStore.mockImplementation(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return null
      })

      await processor.handleParse({ id: 'job-b7-concurrency', data: { id: catalog.id } } as any)

      expect(images.fetchAndStore).toHaveBeenCalledTimes(10)
      expect(maxInFlight).toBeGreaterThan(1)
      expect(maxInFlight).toBeLessThanOrEqual(4)
    })

    it('regression: a catalog whose photo host hangs stops fetching at the budget and still finishes with every row', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b7-hang@example.com`, 'B7 Hang')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csvWithPhotos(16))
      // Each fetch hits the 20 s timeout and fails; a controlled clock stands in for the wait.
      let clock = Date.now()
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock)
      images.fetchAndStore.mockImplementation(async () => {
        clock += 20_000
        return null
      })

      try {
        await processor.handleParse({ id: 'job-b7-hang', data: { id: catalog.id } } as any)
      } finally {
        nowSpy.mockRestore()
      }

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(16)
      expect(images.fetchAndStore.mock.calls.length).toBeLessThan(16)
      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items).toHaveLength(16)
      expect(items.every((item) => item.photoStorageKey === null)).toBe(true)
    })

    it('regression: photos fetched out of order still land on their own rows', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b7-order@example.com`, 'B7 Order')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csvWithPhotos(6))
      images.fetchAndStore.mockImplementation(async (workspaceId: string, catalogId: string, url: string) => {
        const n = Number(url.match(/p(\d+)\.png$/)![1])
        await new Promise((resolve) => setTimeout(resolve, (7 - n) * 3))
        return `${workspaceId}/catalogs/${catalogId}/images/p${n}.png`
      })

      await processor.handleParse({ id: 'job-b7-order', data: { id: catalog.id } } as any)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.sku, item.photoStorageKey?.split('/').pop()])).toEqual([
        ['P1', 'p1.png'],
        ['P2', 'p2.png'],
        ['P3', 'p3.png'],
        ['P4', 'p4.png'],
        ['P5', 'p5.png'],
        ['P6', 'p6.png'],
      ])
    })
  })

  // B5. catalog_items.sku is varchar(200). A longer SKU used to reach the insert
  // as written, Postgres refused the whole batch, and after three attempts the
  // catalog failed with the raw database message. Procurement already keeps the
  // row and drops only the SKU the column cannot hold (validateLineItem); a
  // catalog does the same, and rawRow keeps what the vendor wrote.
  describe('over-long SKUs (B5)', () => {
    const longSku = 'X'.repeat(201)

    it('edge: a SKU of exactly 200 characters is stored as written', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b5-200@example.com`, 'B5 Exact')
      const sku = 'S'.repeat(200)
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', `sku,description\n${sku},Widget\n`)

      await processor.handleParse({ id: 'job-b5-200', data: { id: catalog.id } } as any)

      const [item] = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(item.sku).toBe(sku)
    })

    it('regression: one SKU over 200 characters no longer fails the catalog; that item keeps no SKU and its row keeps the text', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b5-csv@example.com`, 'B5 CSV')
      const csv = ['sku,description', 'A1,Widget', `${longSku},Gadget with a pasted-in spec sheet`, 'C3,Gizmo'].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)

      await expect(
        processor.handleParse({ id: 'job-b5-csv', data: { id: catalog.id }, attemptsMade: 2, opts: { attempts: 3 } } as any),
      ).resolves.toBeUndefined()

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)
      expect(updated.lastError).toBeNull()
      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.lineNumber, item.sku, item.description])).toEqual([
        [1, 'A1', 'Widget'],
        [2, null, 'Gadget with a pasted-in spec sheet'],
        [3, 'C3', 'Gizmo'],
      ])
      expect(items[1].rawRow).toEqual({ sku: longSku, description: 'Gadget with a pasted-in spec sheet' })
    })

    it('regression: a PDF item whose extracted SKU is over 200 characters is stored with no SKU', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b5-pdf@example.com`, 'B5 PDF')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.pdf', 'fake pdf bytes')
      mockRenderPdfToImages.mockResolvedValue({ pages: [Buffer.from([0x01])], total: 1, truncated: false })
      extraction.extractFromImage.mockResolvedValueOnce({
        items: [
          { sku: 'A1', description: 'Widget', confidence: 0.9 },
          { sku: longSku, description: 'Gadget', confidence: 0.4 },
        ],
      })

      await processor.handleParse({ id: 'job-b5-pdf', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.sku, item.description])).toEqual([
        ['A1', 'Widget'],
        [null, 'Gadget'],
      ])
      expect(items[1].rawRow).toMatchObject({ sku: longSku, sourcePageNumber: 1 })
    })
  })

  // B4. Spreadsheet exports end in ",,"-only rows (formatted-but-empty cells),
  // and Papa's skipEmptyLines keeps them: each became a blank catalog item in
  // the list and its counts. An item now needs a SKU or a description.
  describe('blank rows (B4)', () => {
    it('edge: a row with a description and no SKU is kept', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b4-desc@example.com`, 'B4 Desc')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', 'sku,description\n,Loose washers\n')

      await processor.handleParse({ id: 'job-b4-desc', data: { id: catalog.id } } as any)

      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items.map((item) => [item.lineNumber, item.sku, item.description])).toEqual([[1, null, 'Loose washers']])
    })

    it('edge: a PDF item the model read with neither SKU nor description is dropped', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b4-pdf@example.com`, 'B4 PDF')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.pdf', 'fake pdf bytes')
      mockRenderPdfToImages.mockResolvedValue({ pages: [Buffer.from([0x01])], total: 1, truncated: false })
      extraction.extractFromImage.mockResolvedValueOnce({
        items: [
          { sku: null, description: null, confidence: 0.2 },
          { sku: 'A1', description: 'Widget', confidence: 0.9 },
        ],
      })

      await processor.handleParse({ id: 'job-b4-pdf', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.rowCount).toBe(1)
      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items.map((item) => [item.lineNumber, item.sku])).toEqual([[1, 'A1']])
    })

    it('regression: ",," rows and rows with only unmapped columns become no items, and the rest are numbered 1..n', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b4-blank@example.com`, 'B4 Blank')
      const csv = ['sku,description,pack size', 'A1,Widget,10', ',,', ',,5', 'B2,Gadget,2', ',,', ''].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)

      await processor.handleParse({ id: 'job-b4-blank', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.lineNumber, item.sku, item.description])).toEqual([
        [1, 'A1', 'Widget'],
        [2, 'B2', 'Gadget'],
      ])
    })

    it('regression: a blank row with a photo URL fetches no photo', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}b4-photo@example.com`, 'B4 Photo')
      const csv = ['sku,description,photo_url', ',,https://vendor.example.com/orphan.png', 'A1,Widget,'].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)

      await processor.handleParse({ id: 'job-b4-photo', data: { id: catalog.id } } as any)

      expect(images.fetchAndStore).not.toHaveBeenCalled()
      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items.map((item) => item.sku)).toEqual(['A1'])
    })
  })
})
