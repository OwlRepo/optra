import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { catalogItems, catalogs, db, vendors } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { CatalogParseService } from './catalog-parse.service'

@Injectable()
export class CatalogDocumentsService {
  private readonly logger = new Logger(CatalogDocumentsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly parse: CatalogParseService,
  ) {}

  async upload(workspaceId: string, vendorId: string, file: Express.Multer.File) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    const [catalog] = await db
      .insert(catalogs)
      .values({ workspaceId, vendorId, name: file.originalname, sourceKind: 'upload', status: 'pending' })
      .returning()

    const storageKey = `${workspaceId}/catalogs/${catalog.id}/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)
    await db.update(catalogs).set({ storageKey, updatedAt: new Date() }).where(eq(catalogs.id, catalog.id))

    try {
      await this.parse.queueDoc(catalog.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailed(catalog.id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Catalog upload enqueue failed id=${catalog.id}: ${message}`)
      throw error
    }

    return { id: catalog.id, name: catalog.name, status: 'pending' as const }
  }

  async listCatalogs(workspaceId: string, vendorId: string) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    return db
      .select({
        id: catalogs.id,
        name: catalogs.name,
        sourceKind: catalogs.sourceKind,
        status: catalogs.status,
        rowCount: catalogs.rowCount,
        lastError: catalogs.lastError,
        createdAt: catalogs.createdAt,
      })
      .from(catalogs)
      .where(and(eq(catalogs.workspaceId, workspaceId), eq(catalogs.vendorId, vendorId)))
      .orderBy(desc(catalogs.createdAt))
  }

  async listItems(workspaceId: string, vendorId: string, catalogId: string) {
    await this.assertCatalogInWorkspaceAndVendor(workspaceId, vendorId, catalogId)

    return db
      .select({
        id: catalogItems.id,
        sku: catalogItems.sku,
        description: catalogItems.description,
        photoStorageKey: catalogItems.photoStorageKey,
        sourcePageNumber: catalogItems.sourcePageNumber,
      })
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalogId))
      .orderBy(catalogItems.lineNumber)
  }

  private async assertCatalogInWorkspaceAndVendor(workspaceId: string, vendorId: string, catalogId: string) {
    const [catalog] = await db
      .select()
      .from(catalogs)
      .where(and(eq(catalogs.id, catalogId), eq(catalogs.workspaceId, workspaceId), eq(catalogs.vendorId, vendorId)))

    if (!catalog) {
      throw new NotFoundException('Catalog not found')
    }

    return catalog
  }

  private async assertVendorInWorkspace(workspaceId: string, vendorId: string) {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))

    if (!vendor) {
      throw new NotFoundException('Vendor not found')
    }

    return vendor
  }

  private async markFailed(id: string, lastError: string) {
    await db.update(catalogs).set({ status: 'failed', lastError, updatedAt: new Date() }).where(eq(catalogs.id, id))
  }
}
