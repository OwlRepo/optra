import { randomUUID } from 'crypto'
import { extname } from 'path'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { db, invoices, purchaseOrders } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { ProcurementDocKind, ProcurementParseService } from './procurement-parse.service'

function docLabel(kind: ProcurementDocKind): string {
  return kind === 'purchase_order' ? 'Purchase order' : 'Invoice'
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

    const sourceKind = extname(file.originalname).toLowerCase() === '.pdf' ? 'pdf' : 'csv'
    const values = { workspaceId, name: file.originalname, storageKey, status: 'pending' as const, sourceKind }
    const [doc] =
      kind === 'purchase_order'
        ? await db.insert(purchaseOrders).values(values).returning()
        : await db.insert(invoices).values(values).returning()

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
      return db
        .select({
          id: purchaseOrders.id,
          name: purchaseOrders.name,
          status: purchaseOrders.status,
          rowCount: purchaseOrders.rowCount,
          lastError: purchaseOrders.lastError,
          createdAt: purchaseOrders.createdAt,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.workspaceId, workspaceId))
        .orderBy(desc(purchaseOrders.createdAt))
    }

    return db
      .select({
        id: invoices.id,
        name: invoices.name,
        status: invoices.status,
        rowCount: invoices.rowCount,
        lastError: invoices.lastError,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(desc(invoices.createdAt))
  }

  async remove(workspaceId: string, kind: ProcurementDocKind, id: string): Promise<{ message: string }> {
    const doc =
      kind === 'purchase_order'
        ? (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0]
        : (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0]

    if (!doc || doc.workspaceId !== workspaceId) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
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
