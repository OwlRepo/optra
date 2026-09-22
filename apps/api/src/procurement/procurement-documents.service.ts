import { randomUUID } from 'crypto'
import { extname } from 'path'
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { comparisonRuns, db, goodsReceipts, invoices, purchaseOrders, vendors } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { ProcurementDocKind, ProcurementParseService } from './procurement-parse.service'
import { assertUnreachable, docLabel } from './procurement-kind'

// Header metadata supplied by the user at upload time (S3b). Nothing in the
// repo extracts document-level fields, and POLICY v1 #2/#3 want the vendor and
// the PO link chosen explicitly rather than inferred, so these arrive from the
// upload form rather than from the parser.
export type ProcurementPoHeader = {
  vendorId: string
  poNumber: string
  currency: string
}

export type ProcurementInvoiceHeader = {
  purchaseOrderId: string
  invoiceNumber: string
  currency: string
}

// A goods receipt records what arrived, not what it cost, so there is no
// currency here — POLICY v1 #1 declares only SKU, description, the three
// quantities and UOM, and hard stop #1 forbids adding beyond it.
export type ProcurementGrnHeader = {
  purchaseOrderId: string
  grnNumber: string
}

export type ProcurementHeader = ProcurementPoHeader | ProcurementInvoiceHeader | ProcurementGrnHeader

// Which comparison-run column references this kind of document. Extracted so
// the POLICY v1 #9 retention guard cannot silently stop covering a new kind.
function runReferencePredicate(kind: ProcurementDocKind, id: string) {
  switch (kind) {
    case 'purchase_order':
      return eq(comparisonRuns.purchaseOrderId, id)
    case 'invoice':
      return eq(comparisonRuns.invoiceId, id)
    case 'goods_receipt':
      // `comparison_runs` has no goods-receipt column yet — S6 adds it with the
      // three-way match. Until then a receipt genuinely cannot be referenced by
      // a run, so there is nothing to guard against and null skips the check.
      //
      // S6 MUST return that predicate here. If it adds the column and leaves
      // this null, POLICY v1 #9's retention guard silently stops covering
      // receipts and a referenced receipt becomes deletable — which is why this
      // returns null explicitly rather than falling through to a default.
      return null
    default:
      return assertUnreachable(kind)
  }
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

  async upload(
    workspaceId: string,
    kind: ProcurementDocKind,
    file: Express.Multer.File,
    header: ProcurementHeader,
  ) {
    // Resolved BEFORE the object is written. A foreign key only proves the row
    // exists, not that it belongs to this workspace, so the scope is asserted
    // here the way catalog-documents.service.ts does it — and a miss is a 404
    // rather than a 403 so it cannot be used to probe another workspace for
    // valid ids. Doing it first also means a rejected header never leaves an
    // orphan object in storage.
    await this.assertHeaderInWorkspace(workspaceId, kind, header)

    const storageKey = `${workspaceId}/procurement/${kind}/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)

    const extension = extname(file.originalname).toLowerCase()
    const sourceKind = extension === '.pdf' ? 'pdf' : extension === '.xlsx' ? 'xlsx' : 'csv'
    const common = {
      workspaceId,
      name: file.originalname,
      storageKey,
      status: 'pending' as const,
      sourceKind,
    }

    // Normalized here, not in the DTO: validator's isISO4217 is
    // case-INSENSITIVE, so "usd" and "USD" both pass validation and would both
    // reach the column. POLICY v1 #6 compares currencies between a PO and its
    // invoice in S6; two spellings of the same currency would read as a
    // mismatch and manufacture exactly the false discrepancy this product
    // exists to remove. The global ValidationPipe runs without `transform`, so
    // a class-transformer @Transform would never fire — it has to be here.
    //
    // Lives per-branch rather than in `common` because a goods receipt has no
    // currency column at all.
    const normalizedCurrency = (value: string) => value.toUpperCase()

    // The object is written first; if the row cannot be created the object
    // would be unreachable forever, so remove it before surfacing the error.
    let inserted: { id: string; name: string; status: 'pending' | 'processing' | 'done' | 'failed' }[]
    try {
      switch (kind) {
        case 'purchase_order': {
          const poHeader = header as ProcurementPoHeader
          inserted = await db
            .insert(purchaseOrders)
            .values({
              ...common,
              currency: normalizedCurrency(poHeader.currency),
              vendorId: poHeader.vendorId,
              poNumber: poHeader.poNumber,
            })
            .returning()
          break
        }
        case 'invoice': {
          const invoiceHeader = header as ProcurementInvoiceHeader
          inserted = await db
            .insert(invoices)
            .values({
              ...common,
              currency: normalizedCurrency(invoiceHeader.currency),
              purchaseOrderId: invoiceHeader.purchaseOrderId,
              invoiceNumber: invoiceHeader.invoiceNumber,
            })
            .returning()
          break
        }
        case 'goods_receipt': {
          const grnHeader = header as ProcurementGrnHeader
          inserted = await db
            .insert(goodsReceipts)
            .values({
              ...common,
              purchaseOrderId: grnHeader.purchaseOrderId,
              grnNumber: grnHeader.grnNumber,
            })
            .returning()
          break
        }
        default:
          return assertUnreachable(kind)
      }
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

  /**
   * Split from a single `list(workspaceId, kind)` in S3b. Once the two
   * projections stopped being the same shape, one method returned a union that
   * no caller could narrow by its `kind` argument — reading `invoiceNumber` off
   * it was a type error even when the kind was a literal. Two methods give each
   * caller the exact shape it asked for.
   */
  async listPurchaseOrders(workspaceId: string) {
    // leftJoin, not innerJoin: rows written before migration 0025 have no
    // vendor, and they must still appear in the list with a null name rather
    // than vanishing from the table.
    const rows = await db
      .select({
        id: purchaseOrders.id,
        name: purchaseOrders.name,
        status: purchaseOrders.status,
        rowCount: purchaseOrders.rowCount,
        lastError: purchaseOrders.lastError,
        createdAt: purchaseOrders.createdAt,
        storageKey: purchaseOrders.storageKey,
        poNumber: purchaseOrders.poNumber,
        currency: purchaseOrders.currency,
        vendorId: purchaseOrders.vendorId,
        vendorName: vendors.name,
      })
      .from(purchaseOrders)
      .leftJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(eq(purchaseOrders.workspaceId, workspaceId))
      .orderBy(desc(purchaseOrders.createdAt))

    return rows.map(toListItem)
  }

  async listInvoices(workspaceId: string) {
    const rows = await db
      .select({
        id: invoices.id,
        name: invoices.name,
        status: invoices.status,
        rowCount: invoices.rowCount,
        lastError: invoices.lastError,
        createdAt: invoices.createdAt,
        storageKey: invoices.storageKey,
        invoiceNumber: invoices.invoiceNumber,
        currency: invoices.currency,
        purchaseOrderId: invoices.purchaseOrderId,
      })
      .from(invoices)
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(desc(invoices.createdAt))

    return rows.map(toListItem)
  }

  async listGoodsReceipts(workspaceId: string) {
    const rows = await db
      .select({
        id: goodsReceipts.id,
        name: goodsReceipts.name,
        status: goodsReceipts.status,
        rowCount: goodsReceipts.rowCount,
        lastError: goodsReceipts.lastError,
        createdAt: goodsReceipts.createdAt,
        storageKey: goodsReceipts.storageKey,
        grnNumber: goodsReceipts.grnNumber,
        purchaseOrderId: goodsReceipts.purchaseOrderId,
      })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.workspaceId, workspaceId))
      .orderBy(desc(goodsReceipts.createdAt))

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
    const doc = await this.loadHeader(kind, id)

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
    const doc = await this.loadHeader(kind, id)

    if (!doc || doc.workspaceId !== workspaceId) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }

    // POLICY v1 #9: a document referenced by a comparison run is evidence, and
    // deleting it would cascade away that run and its flags. This method has no
    // route and no production caller; the guard is here so exposing it later
    // cannot silently destroy an audit trail.
    const runPredicate = runReferencePredicate(kind, id)
    const [referencingRun] = runPredicate
      ? await db
          .select({ id: comparisonRuns.id })
          .from(comparisonRuns)
          .where(and(eq(comparisonRuns.workspaceId, workspaceId), runPredicate))
          .limit(1)
      : []

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

    switch (kind) {
      case 'purchase_order':
        await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id))
        break
      case 'invoice':
        await db.delete(invoices).where(eq(invoices.id, id))
        break
      case 'goods_receipt':
        await db.delete(goodsReceipts).where(eq(goodsReceipts.id, id))
        break
      default:
        assertUnreachable(kind)
    }

    return { message: `${docLabel(kind)} deleted` }
  }

  /**
   * S3b. Asserts that the id the uploader chose belongs to the uploader's own
   * workspace. POLICY v1 #3 says the PO's vendor comes from the workspace's
   * existing `vendors`; POLICY v1 #2 says the invoice's PO is picked explicitly.
   * Neither is enforceable by the foreign key alone, which only checks that the
   * row exists somewhere in the table.
   */
  private async assertHeaderInWorkspace(
    workspaceId: string,
    kind: ProcurementDocKind,
    header: ProcurementHeader,
  ): Promise<void> {
    switch (kind) {
      case 'purchase_order': {
        const vendorId = (header as ProcurementPoHeader).vendorId
        const [vendor] = await db
          .select({ id: vendors.id })
          .from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, workspaceId)))
          .limit(1)
        if (!vendor) {
          throw new NotFoundException('Vendor not found')
        }
        return
      }
      // Both link to a purchase order (POLICY v1 #2), so the same check serves
      // them — but they are listed separately rather than sharing a fallthrough
      // so a future kind cannot land here by accident.
      case 'invoice':
      case 'goods_receipt': {
        const purchaseOrderId = (header as ProcurementInvoiceHeader | ProcurementGrnHeader).purchaseOrderId
        const [po] = await db
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.workspaceId, workspaceId)))
          .limit(1)
        if (!po) {
          throw new NotFoundException('Purchase order not found')
        }
        return
      }
      default:
        return assertUnreachable(kind)
    }
  }

  // One place mapping a kind to its header table. getDownloadable and remove
  // both used to inline this ternary, which is two chances to forget a kind.
  private async loadHeader(kind: ProcurementDocKind, id: string) {
    switch (kind) {
      case 'purchase_order':
        return (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0]
      case 'invoice':
        return (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0]
      case 'goods_receipt':
        return (await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1))[0]
      default:
        return assertUnreachable(kind)
    }
  }

  private async markFailed(kind: ProcurementDocKind, id: string, lastError: string) {
    const updatedAt = new Date()
    const patch = { status: 'failed' as const, lastError, updatedAt }
    switch (kind) {
      case 'purchase_order':
        await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id))
        break
      case 'invoice':
        await db.update(invoices).set(patch).where(eq(invoices.id, id))
        break
      case 'goods_receipt':
        await db.update(goodsReceipts).set(patch).where(eq(goodsReceipts.id, id))
        break
      default:
        assertUnreachable(kind)
    }
  }
}
