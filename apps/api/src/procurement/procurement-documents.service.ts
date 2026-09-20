import { randomUUID } from 'crypto'
import { extname } from 'path'
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { comparisonRuns, db, invoices, purchaseOrders } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { ProcurementDocKind, ProcurementParseService } from './procurement-parse.service'

function docLabel(kind: ProcurementDocKind): string {
  return kind === 'purchase_order' ? 'Purchase order' : 'Invoice'
}

// The UI needs to know whether a row has bytes to download, but the storage key
// is an internal S3 path and never leaves the API.
function toListItem<T extends { storageKey: string | null }>(row: T): Omit<T, 'storageKey'> & { hasSourceFile: boolean } {
  const { storageKey, ...rest } = row
  return { ...rest, hasSourceFile: storageKey !== null }
}

@Injectable()
export class ProcurementDocumentsService {
  private readonly logger = new Logger(ProcurementDocumentsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly parse: ProcurementParseService,
  ) {}

  async upload(workspaceId: string, kind: ProcurementDocKind, file: Express.Multer.File) {
    const storageKey = `${workspaceId}/procurement/${kind}/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)

    const extension = extname(file.originalname).toLowerCase()
    const sourceKind = extension === '.pdf' ? 'pdf' : extension === '.xlsx' ? 'xlsx' : 'csv'
    const values = { workspaceId, name: file.originalname, storageKey, status: 'pending' as const, sourceKind }

    // The object is written first; if the row cannot be created the object
    // would be unreachable forever, so remove it before surfacing the error.
    let inserted: { id: string; name: string; status: 'pending' | 'processing' | 'done' | 'failed' }[]
    try {
      inserted =
        kind === 'purchase_order'
          ? await db.insert(purchaseOrders).values(values).returning()
          : await db.insert(invoices).values(values).returning()
    } catch (error) {
      await this.storage.delete(storageKey).catch((cleanupError: unknown) => {
        this.logger.warn(
          `Procurement upload cleanup failed kind=${kind} key=${storageKey}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      })
      throw error
    }
    const [doc] = inserted

    try {
      await this.parse.queueDoc(kind, doc.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailed(kind, doc.id, `Queue enqueue failed: ${message}`)
      this.logger.error(`Procurement upload enqueue failed kind=${kind} id=${doc.id}: ${message}`)
      throw error
    }

    return { id: doc.id, name: doc.name, status: doc.status }
  }

  async list(workspaceId: string, kind: ProcurementDocKind) {
    if (kind === 'purchase_order') {
      const rows = await db
        .select({
          id: purchaseOrders.id,
          name: purchaseOrders.name,
          status: purchaseOrders.status,
          rowCount: purchaseOrders.rowCount,
          lastError: purchaseOrders.lastError,
          createdAt: purchaseOrders.createdAt,
          storageKey: purchaseOrders.storageKey,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.workspaceId, workspaceId))
        .orderBy(desc(purchaseOrders.createdAt))

      return rows.map(toListItem)
    }

    const rows = await db
      .select({
        id: invoices.id,
        name: invoices.name,
        status: invoices.status,
        rowCount: invoices.rowCount,
        lastError: invoices.lastError,
        createdAt: invoices.createdAt,
        storageKey: invoices.storageKey,
      })
      .from(invoices)
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(desc(invoices.createdAt))

    return rows.map(toListItem)
  }

  /**
   * The original uploaded bytes, for a reviewer who wants to see the source
   * behind a discrepancy (D4). Scoped the way the knowledge-base download is:
   * the caller supplies an id, never a storage key, and the row's workspace is
   * asserted before `storageKey` is touched. A mismatch is a 404 rather than a
   * 403 so it cannot be used to probe for documents in other workspaces.
   */
  async getDownloadable(workspaceId: string, kind: ProcurementDocKind, id: string) {
    const doc =
      kind === 'purchase_order'
        ? (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0]
        : (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0]

    if (!doc || doc.workspaceId !== workspaceId) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }
    // Distinct from "not found": the column is nullable, and a header can exist
    // with no object behind it.
    if (!doc.storageKey) {
      throw new NotFoundException(`${docLabel(kind)} has no stored file`)
    }

    const buffer = await this.storage.getBuffer(doc.storageKey)
    return { name: doc.name, buffer }
  }

  async remove(workspaceId: string, kind: ProcurementDocKind, id: string): Promise<{ message: string }> {
    const doc =
      kind === 'purchase_order'
        ? (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0]
        : (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0]

    if (!doc || doc.workspaceId !== workspaceId) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }

    // POLICY v1 #9: a document referenced by a comparison run is evidence, and
    // deleting it would cascade away that run and its flags. This method has no
    // route and no production caller; the guard is here so exposing it later
    // cannot silently destroy an audit trail.
    const [referencingRun] = await db
      .select({ id: comparisonRuns.id })
      .from(comparisonRuns)
      .where(
        and(
          eq(comparisonRuns.workspaceId, workspaceId),
          kind === 'purchase_order' ? eq(comparisonRuns.purchaseOrderId, id) : eq(comparisonRuns.invoiceId, id),
        ),
      )
      .limit(1)

    if (referencingRun) {
      throw new ConflictException(`${docLabel(kind)} is referenced by a comparison run and cannot be deleted`)
    }

    if (doc.storageKey) {
      await this.storage.delete(doc.storageKey).catch((error: unknown) => {
        this.logger.warn(
          `Failed to delete storage object ${doc.storageKey}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }

    if (kind === 'purchase_order') {
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id))
    } else {
      await db.delete(invoices).where(eq(invoices.id, id))
    }

    return { message: `${docLabel(kind)} deleted` }
  }

  private async markFailed(kind: ProcurementDocKind, id: string, lastError: string) {
    const updatedAt = new Date()
    if (kind === 'purchase_order') {
      await db
        .update(purchaseOrders)
        .set({ status: 'failed', lastError, updatedAt })
        .where(eq(purchaseOrders.id, id))
    } else {
      await db.update(invoices).set({ status: 'failed', lastError, updatedAt }).where(eq(invoices.id, id))
    }
  }
}
