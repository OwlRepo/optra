import { randomUUID } from 'crypto'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { catalogItems, catalogs, db, vendors } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { readOrNotFound } from '../storage/storage.errors'
import { CatalogParseService } from './catalog-parse.service'

// Raster types only, and an allowlist rather than "serve whatever we stored".
// CatalogImageService accepts any remote `image/*`, which includes
// `image/svg+xml` — and an SVG can carry script, so echoing the stored type
// back verbatim would turn a mislabelled file into stored XSS. These render in
// an <img> and cannot execute.
const SERVABLE_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

// Prefer what the object was actually stored with; fall back to the key's
// extension only when the object carries no type (older keys predate `save()`
// recording one).
function resolvePhotoContentType(storageKey: string, storedContentType: string | null): string {
  const stored = storedContentType?.split(';')[0].trim().toLowerCase()

  if (stored) {
    if (!SERVABLE_PHOTO_TYPES.has(stored)) {
      throw new BadRequestException('Unsupported image type')
    }
    return stored
  }

  const dot = storageKey.lastIndexOf('.')
  const fromExtension = dot === -1 ? undefined : EXTENSION_CONTENT_TYPES[storageKey.slice(dot).toLowerCase()]

  if (!fromExtension) {
    throw new BadRequestException('Unsupported image type')
  }

  return fromExtension
}

@Injectable()
export class CatalogDocumentsService {
  private readonly logger = new Logger(CatalogDocumentsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly parse: CatalogParseService,
  ) {}

  async upload(workspaceId: string, vendorId: string, file: Express.Multer.File) {
    await this.assertVendorInWorkspace(workspaceId, vendorId)

    // The file is stored BEFORE the row exists, and the row is written with
    // its key in one insert. Row-first left a `pending` catalog with a null
    // key behind whenever the save failed, and nothing ever cleaned it up.
    // The id is minted here so the key can still carry it.
    const catalogId = randomUUID()
    const storageKey = `${workspaceId}/catalogs/${catalogId}/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)

    let catalog: typeof catalogs.$inferSelect
    try {
      [catalog] = await db
        .insert(catalogs)
        .values({
          id: catalogId,
          workspaceId,
          vendorId,
          name: file.originalname,
          sourceKind: 'upload',
          status: 'pending',
          storageKey,
        })
        .returning()
    } catch (error) {
      // Nothing points at the object now; remove it rather than orphan it.
      await this.storage.delete(storageKey).catch((cleanupError: unknown) => {
        this.logger.warn(
          `Could not remove orphaned catalog object after a failed insert: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        )
      })
      throw error
    }

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

  /**
   * Streams the photo attached to a catalog item. Scoped by workspaceId in the
   * query itself rather than by a guard alone — this is a tenant-scoped read of
   * object storage, so the isolation belongs in the WHERE clause.
   */
  async getItemPhoto(workspaceId: string, itemId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const [item] = await db
      .select({ photoStorageKey: catalogItems.photoStorageKey })
      .from(catalogItems)
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.workspaceId, workspaceId)))
      .limit(1)

    if (!item) {
      throw new NotFoundException('Catalog item not found')
    }
    if (!item.photoStorageKey) {
      throw new NotFoundException('Catalog item has no photo')
    }

    const { buffer, contentType } = await readOrNotFound(
      this.storage.getObject(item.photoStorageKey),
      'Catalog item photo is missing',
      this.logger,
    )
    return { buffer, contentType: resolvePhotoContentType(item.photoStorageKey, contentType) }
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
