import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { and, asc, count, eq, isNull, notInArray, sql } from 'drizzle-orm'
import {
  buildOffsetResult,
  db,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  poLineItems,
  purchaseOrders,
  resolveOffsetPage,
} from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { readOrNotFound } from '../storage/storage.errors'
import { ProcurementCompareService } from './procurement-compare.service'
import { assertUnreachable, docLabel } from './procurement-kind'
import { photoPageKey } from './procurement-photo'
import type { ProcurementDocKind } from './procurement-parse.service'

// Mirrors packages/types/src/procurement.ts (the locked contract). Not imported:
// apps/api compiles with `include: ["src"]`, and a source import from outside
// it would move tsc's rootDir and change the dist layout Nest boots from.
export type DetectedProcurementKind = 'purchase_order' | 'invoice' | 'goods_receipt' | 'unknown'

export interface ProcurementReviewDocument {
  id: string
  name: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  sourceKind: string
  pageCount: number | null
  detectedKind: DetectedProcurementKind | null
  reviewRequired: boolean
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface ProcurementReviewLine {
  id: string
  lineNumber: number | null
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  uom: string | null
  quantityReceived?: string | null
  quantityAccepted?: string | null
  quantityRejected?: string | null
  extractionConfidence: number | null
  sourceKind: string
  editedAt: string | null
  editedBy: string | null
}

export interface ProcurementDocumentLines {
  document: ProcurementReviewDocument
  items: ProcurementReviewLine[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ReviewLineInput {
  id?: string
  sku?: string | null
  description?: string | null
  quantity?: string | null
  unitPrice?: string | null
  lineTotal?: string | null
  uom?: string | null
  quantityReceived?: string | null
  quantityAccepted?: string | null
  quantityRejected?: string | null
}

export interface ReviewDocumentRequest {
  lines: ReviewLineInput[]
}

export interface ReviewDocumentResponse {
  id: string
  reviewedAt: string
  rowCount: number
}

type FieldType = 'text' | 'numeric'
type FieldKey = Exclude<keyof ReviewLineInput, 'id'>

export interface FieldSpec {
  key: FieldKey
  column: string
  type: FieldType
}

const COMMON_TEXT: FieldSpec[] = [
  { key: 'sku', column: 'sku', type: 'text' },
  { key: 'description', column: 'description', type: 'text' },
  { key: 'uom', column: 'uom', type: 'text' },
]

// Editable columns per line table. Constant identifiers only: they are written
// into SQL with sql.raw, so nothing request-derived may ever reach this table.
const LINE_FIELDS: Record<ProcurementDocKind, FieldSpec[]> = {
  purchase_order: [
    ...COMMON_TEXT,
    { key: 'quantity', column: 'quantity', type: 'numeric' },
    { key: 'unitPrice', column: 'unit_price', type: 'numeric' },
    { key: 'lineTotal', column: 'line_total', type: 'numeric' },
  ],
  invoice: [
    ...COMMON_TEXT,
    { key: 'quantity', column: 'quantity', type: 'numeric' },
    { key: 'unitPrice', column: 'unit_price', type: 'numeric' },
    { key: 'lineTotal', column: 'line_total', type: 'numeric' },
  ],
  goods_receipt: [
    ...COMMON_TEXT,
    { key: 'quantityReceived', column: 'quantity_received', type: 'numeric' },
    { key: 'quantityAccepted', column: 'quantity_accepted', type: 'numeric' },
    { key: 'quantityRejected', column: 'quantity_rejected', type: 'numeric' },
  ],
}

const LINE_TABLE: Record<ProcurementDocKind, { table: string; documentColumn: string }> = {
  purchase_order: { table: 'po_line_items', documentColumn: 'purchase_order_id' },
  invoice: { table: 'invoice_line_items', documentColumn: 'invoice_id' },
  goods_receipt: { table: 'goods_receipt_line_items', documentColumn: 'goods_receipt_id' },
}

type Values = Partial<Record<FieldKey, string | null>>

function toConfidence(value: string | null): number | null {
  if (value === null) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sameValue(type: FieldType, a: string | null, b: string | null): boolean {
  if (a === b) {
    return true
  }
  if (a === null || b === null) {
    return false
  }
  return type === 'numeric' && Number(a) === Number(b)
}

@Injectable()
export class ProcurementReviewService {
  private readonly logger = new Logger(ProcurementReviewService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly compareService: ProcurementCompareService,
  ) {}

  async listLines(
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
    query: { page?: number | string; pageSize?: number | string },
  ): Promise<ProcurementDocumentLines> {
    const document = await this.loadReviewDocument(workspaceId, kind, docId)
    const { page, pageSize, offset } = resolveOffsetPage(query.page, query.pageSize)
    const { items, total } = await this.selectLines(workspaceId, kind, docId, pageSize, offset)
    return { document, ...buildOffsetResult(items, total, page, pageSize) }
  }

  /** The stored JPEG of page `n` (1-based). Foreign, non-photo or out-of-range is a 404 before storage is read. */
  async getPage(workspaceId: string, kind: ProcurementDocKind, docId: string, n: number): Promise<Buffer> {
    const header = await this.loadPhotoHeader(workspaceId, kind, docId)
    if (
      header.sourceKind !== 'image' ||
      !header.storageKey ||
      header.pageCount === null ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > header.pageCount
    ) {
      throw new NotFoundException('Page not found')
    }

    return readOrNotFound(this.storage.getBuffer(photoPageKey(header.storageKey, n)), 'Page not found', this.logger)
  }

  async review(
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
    userId: string,
    body: ReviewDocumentRequest,
  ): Promise<ReviewDocumentResponse> {
    const now = new Date()

    const reviewedAt = await db.transaction(async (tx) => {
      // The race guard: only one confirm can flip reviewed_at. A concurrent
      // second confirm waits on the row lock, re-checks the WHERE, matches
      // nothing and falls into the diagnosis below.
      const claimed = await this.claimHeader(tx, kind, workspaceId, docId, userId, now)
      if (!claimed) {
        await this.explainRejection(tx, kind, workspaceId, docId)
        throw new NotFoundException(`${docLabel(kind)} not found`)
      }

      await this.applyLines(tx, kind, workspaceId, docId, userId, body.lines, now)
      return claimed
    })

    // After commit, and never fatal: the review is already durable, and a queue
    // that will not take the follow-up is not the reviewer's problem.
    await this.compareService
      .enqueueForDocument(kind, docId)
      .catch((error: unknown) =>
        this.logger.warn(
          `Auto-compare enqueue failed after review kind=${kind} id=${docId}: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
      )

    return { id: docId, reviewedAt: reviewedAt.toISOString(), rowCount: body.lines.length }
  }

  // ---- review internals ----------------------------------------------------

  private async applyLines(
    tx: Tx,
    kind: ProcurementDocKind,
    workspaceId: string,
    docId: string,
    userId: string,
    lines: ReviewLineInput[],
    now: Date,
  ) {
    const fields = LINE_FIELDS[kind]
    const spec = LINE_TABLE[kind]

    const ids = lines.map((line) => line.id).filter((id): id is string => id !== undefined)
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate line ids in the review body')
    }

    const existing = await this.loadExistingLines(tx, kind, workspaceId, docId)
    for (const id of ids) {
      if (!existing.has(id)) {
        throw new NotFoundException('Line not found')
      }
    }

    const keptRows: Array<{ id: string; lineNumber: number; changed: boolean; prior: string | null; values: Values }> = []
    const newRows: Array<{ lineNumber: number; values: Values }> = []

    lines.forEach((line, index) => {
      const lineNumber = index + 1
      if (line.id === undefined) {
        const values: Values = {}
        for (const field of fields) {
          values[field.key] = line[field.key] ?? null
        }
        newRows.push({ lineNumber, values })
        return
      }

      const before = existing.get(line.id) as Values
      const values: Values = {}
      let changed = false
      for (const field of fields) {
        // Omitted = keep what is stored; explicit null = clear it.
        const next = line[field.key] === undefined ? (before[field.key] ?? null) : (line[field.key] ?? null)
        values[field.key] = next
        if (!sameValue(field.type, before[field.key] ?? null, next)) {
          changed = true
        }
      }
      keptRows.push({ id: line.id, lineNumber, changed, prior: changed ? JSON.stringify(before) : null, values })
    })

    // Deleting first keeps the surviving line numbers contiguous: the renumber
    // below then only has to cover rows that are staying.
    await this.deleteLinesNotIn(tx, kind, workspaceId, docId, ids)

    if (keptRows.length > 0) {
      const columnList = ['id', 'line_number', 'changed', 'prior', ...fields.map((f) => f.column)]
      const valueRows = keptRows.map(
        (row) =>
          sql`(${row.id}::uuid, ${row.lineNumber}::int, ${row.changed}::boolean, ${row.prior}::jsonb, ${sql.join(
            fields.map((f) => sql`${row.values[f.key] ?? null}::${sql.raw(f.type)}`),
            sql`, `,
          )})`,
      )
      const setValues = fields.map((f) => `${f.column} = v.${f.column}`).join(', ')

      // One statement for every kept line (no N+1). extracted_values keeps the
      // FIRST capture: COALESCE never overwrites an earlier AI original.
      await tx.execute(sql`
        UPDATE ${sql.raw(spec.table)} AS t
        SET line_number = v.line_number,
            ${sql.raw(setValues)},
            edited_at = CASE WHEN v.changed THEN ${now.toISOString()}::timestamp ELSE t.edited_at END,
            edited_by = CASE WHEN v.changed THEN ${userId}::uuid ELSE t.edited_by END,
            extracted_values = CASE WHEN v.changed THEN COALESCE(t.extracted_values, v.prior) ELSE t.extracted_values END
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(${sql.raw(columnList.join(', '))})
        WHERE t.id = v.id
          AND t.workspace_id = ${workspaceId}::uuid
          AND t.${sql.raw(spec.documentColumn)} = ${docId}::uuid
      `)
    }

    if (newRows.length > 0) {
      await this.insertManualLines(tx, kind, workspaceId, docId, newRows)
    }

    await this.setRowCount(tx, kind, workspaceId, docId, lines.length)
  }

  private async claimHeader(
    tx: Tx,
    kind: ProcurementDocKind,
    workspaceId: string,
    docId: string,
    userId: string,
    now: Date,
  ): Promise<Date | null> {
    const patch = { reviewedAt: now, reviewedBy: userId, updatedAt: now }
    switch (kind) {
      case 'purchase_order': {
        const rows = await tx
          .update(purchaseOrders)
          .set(patch)
          .where(
            and(
              eq(purchaseOrders.id, docId),
              eq(purchaseOrders.workspaceId, workspaceId),
              eq(purchaseOrders.reviewRequired, true),
              isNull(purchaseOrders.reviewedAt),
              eq(purchaseOrders.status, 'done'),
            ),
          )
          .returning({ reviewedAt: purchaseOrders.reviewedAt })
        return rows[0]?.reviewedAt ?? null
      }
      case 'invoice': {
        const rows = await tx
          .update(invoices)
          .set(patch)
          .where(
            and(
              eq(invoices.id, docId),
              eq(invoices.workspaceId, workspaceId),
              eq(invoices.reviewRequired, true),
              isNull(invoices.reviewedAt),
              eq(invoices.status, 'done'),
            ),
          )
          .returning({ reviewedAt: invoices.reviewedAt })
        return rows[0]?.reviewedAt ?? null
      }
      case 'goods_receipt': {
        const rows = await tx
          .update(goodsReceipts)
          .set(patch)
          .where(
            and(
              eq(goodsReceipts.id, docId),
              eq(goodsReceipts.workspaceId, workspaceId),
              eq(goodsReceipts.reviewRequired, true),
              isNull(goodsReceipts.reviewedAt),
              eq(goodsReceipts.status, 'done'),
            ),
          )
          .returning({ reviewedAt: goodsReceipts.reviewedAt })
        return rows[0]?.reviewedAt ?? null
      }
      default:
        return assertUnreachable(kind)
    }
  }

  // The conditional UPDATE matched nothing: say why. Throws on every path that
  // has a better answer than 404; falls through (caller throws 404) otherwise.
  private async explainRejection(tx: Tx, kind: ProcurementDocKind, workspaceId: string, docId: string) {
    const header = await this.loadStateWith(tx, kind, workspaceId, docId)
    if (!header) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }
    if (header.reviewedAt !== null) {
      throw new ConflictException(`${docLabel(kind)} was already reviewed`)
    }
    if (!header.reviewRequired) {
      throw new BadRequestException(`${docLabel(kind)} does not need review`)
    }
    if (header.status !== 'done') {
      throw new ConflictException(`${docLabel(kind)} is still parsing`)
    }
  }

  private async loadStateWith(tx: Tx | typeof db, kind: ProcurementDocKind, workspaceId: string, docId: string) {
    switch (kind) {
      case 'purchase_order':
        return (
          await tx
            .select({ status: purchaseOrders.status, reviewRequired: purchaseOrders.reviewRequired, reviewedAt: purchaseOrders.reviewedAt })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.id, docId), eq(purchaseOrders.workspaceId, workspaceId)))
            .limit(1)
        )[0]
      case 'invoice':
        return (
          await tx
            .select({ status: invoices.status, reviewRequired: invoices.reviewRequired, reviewedAt: invoices.reviewedAt })
            .from(invoices)
            .where(and(eq(invoices.id, docId), eq(invoices.workspaceId, workspaceId)))
            .limit(1)
        )[0]
      case 'goods_receipt':
        return (
          await tx
            .select({ status: goodsReceipts.status, reviewRequired: goodsReceipts.reviewRequired, reviewedAt: goodsReceipts.reviewedAt })
            .from(goodsReceipts)
            .where(and(eq(goodsReceipts.id, docId), eq(goodsReceipts.workspaceId, workspaceId)))
            .limit(1)
        )[0]
      default:
        return assertUnreachable(kind)
    }
  }

  private async loadExistingLines(
    tx: Tx,
    kind: ProcurementDocKind,
    workspaceId: string,
    docId: string,
  ): Promise<Map<string, Values>> {
    const map = new Map<string, Values>()
    switch (kind) {
      case 'purchase_order': {
        const rows = await tx
          .select({
            id: poLineItems.id,
            sku: poLineItems.sku,
            description: poLineItems.description,
            uom: poLineItems.uom,
            quantity: poLineItems.quantity,
            unitPrice: poLineItems.unitPrice,
            lineTotal: poLineItems.lineTotal,
          })
          .from(poLineItems)
          .where(and(eq(poLineItems.workspaceId, workspaceId), eq(poLineItems.purchaseOrderId, docId)))
        for (const { id, ...values } of rows) map.set(id, values)
        return map
      }
      case 'invoice': {
        const rows = await tx
          .select({
            id: invoiceLineItems.id,
            sku: invoiceLineItems.sku,
            description: invoiceLineItems.description,
            uom: invoiceLineItems.uom,
            quantity: invoiceLineItems.quantity,
            unitPrice: invoiceLineItems.unitPrice,
            lineTotal: invoiceLineItems.lineTotal,
          })
          .from(invoiceLineItems)
          .where(and(eq(invoiceLineItems.workspaceId, workspaceId), eq(invoiceLineItems.invoiceId, docId)))
        for (const { id, ...values } of rows) map.set(id, values)
        return map
      }
      case 'goods_receipt': {
        const rows = await tx
          .select({
            id: goodsReceiptLineItems.id,
            sku: goodsReceiptLineItems.sku,
            description: goodsReceiptLineItems.description,
            uom: goodsReceiptLineItems.uom,
            quantityReceived: goodsReceiptLineItems.quantityReceived,
            quantityAccepted: goodsReceiptLineItems.quantityAccepted,
            quantityRejected: goodsReceiptLineItems.quantityRejected,
          })
          .from(goodsReceiptLineItems)
          .where(and(eq(goodsReceiptLineItems.workspaceId, workspaceId), eq(goodsReceiptLineItems.goodsReceiptId, docId)))
        for (const { id, ...values } of rows) map.set(id, values)
        return map
      }
      default:
        return assertUnreachable(kind)
    }
  }

  private async deleteLinesNotIn(tx: Tx, kind: ProcurementDocKind, workspaceId: string, docId: string, keepIds: string[]) {
    switch (kind) {
      case 'purchase_order':
        await tx
          .delete(poLineItems)
          .where(
            and(
              eq(poLineItems.workspaceId, workspaceId),
              eq(poLineItems.purchaseOrderId, docId),
              keepIds.length > 0 ? notInArray(poLineItems.id, keepIds) : undefined,
            ),
          )
        return
      case 'invoice':
        await tx
          .delete(invoiceLineItems)
          .where(
            and(
              eq(invoiceLineItems.workspaceId, workspaceId),
              eq(invoiceLineItems.invoiceId, docId),
              keepIds.length > 0 ? notInArray(invoiceLineItems.id, keepIds) : undefined,
            ),
          )
        return
      case 'goods_receipt':
        await tx
          .delete(goodsReceiptLineItems)
          .where(
            and(
              eq(goodsReceiptLineItems.workspaceId, workspaceId),
              eq(goodsReceiptLineItems.goodsReceiptId, docId),
              keepIds.length > 0 ? notInArray(goodsReceiptLineItems.id, keepIds) : undefined,
            ),
          )
        return
      default:
        assertUnreachable(kind)
    }
  }

  private async insertManualLines(
    tx: Tx,
    kind: ProcurementDocKind,
    workspaceId: string,
    docId: string,
    rows: Array<{ lineNumber: number; values: Values }>,
  ) {
    switch (kind) {
      case 'purchase_order':
        await tx.insert(poLineItems).values(
          rows.map(({ lineNumber, values }) => ({
            workspaceId,
            purchaseOrderId: docId,
            lineNumber,
            sku: values.sku ?? null,
            description: values.description ?? null,
            uom: values.uom ?? null,
            quantity: values.quantity ?? null,
            unitPrice: values.unitPrice ?? null,
            lineTotal: values.lineTotal ?? null,
            sourceKind: 'manual',
          })),
        )
        return
      case 'invoice':
        await tx.insert(invoiceLineItems).values(
          rows.map(({ lineNumber, values }) => ({
            workspaceId,
            invoiceId: docId,
            lineNumber,
            sku: values.sku ?? null,
            description: values.description ?? null,
            uom: values.uom ?? null,
            quantity: values.quantity ?? null,
            unitPrice: values.unitPrice ?? null,
            lineTotal: values.lineTotal ?? null,
            sourceKind: 'manual',
          })),
        )
        return
      case 'goods_receipt':
        await tx.insert(goodsReceiptLineItems).values(
          rows.map(({ lineNumber, values }) => ({
            workspaceId,
            goodsReceiptId: docId,
            lineNumber,
            sku: values.sku ?? null,
            description: values.description ?? null,
            uom: values.uom ?? null,
            quantityReceived: values.quantityReceived ?? null,
            quantityAccepted: values.quantityAccepted ?? null,
            quantityRejected: values.quantityRejected ?? null,
            sourceKind: 'manual',
          })),
        )
        return
      default:
        assertUnreachable(kind)
    }
  }

  private async setRowCount(tx: Tx, kind: ProcurementDocKind, workspaceId: string, docId: string, rowCount: number) {
    switch (kind) {
      case 'purchase_order':
        await tx
          .update(purchaseOrders)
          .set({ rowCount })
          .where(and(eq(purchaseOrders.id, docId), eq(purchaseOrders.workspaceId, workspaceId)))
        return
      case 'invoice':
        await tx
          .update(invoices)
          .set({ rowCount })
          .where(and(eq(invoices.id, docId), eq(invoices.workspaceId, workspaceId)))
        return
      case 'goods_receipt':
        await tx
          .update(goodsReceipts)
          .set({ rowCount })
          .where(and(eq(goodsReceipts.id, docId), eq(goodsReceipts.workspaceId, workspaceId)))
        return
      default:
        assertUnreachable(kind)
    }
  }

  // ---- reads ---------------------------------------------------------------

  private async loadPhotoHeader(workspaceId: string, kind: ProcurementDocKind, docId: string) {
    let row:
      | { sourceKind: string; storageKey: string | null; pageCount: number | null }
      | undefined
    switch (kind) {
      case 'purchase_order':
        row = (
          await db
            .select({ sourceKind: purchaseOrders.sourceKind, storageKey: purchaseOrders.storageKey, pageCount: purchaseOrders.pageCount })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.id, docId), eq(purchaseOrders.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      case 'invoice':
        row = (
          await db
            .select({ sourceKind: invoices.sourceKind, storageKey: invoices.storageKey, pageCount: invoices.pageCount })
            .from(invoices)
            .where(and(eq(invoices.id, docId), eq(invoices.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      case 'goods_receipt':
        row = (
          await db
            .select({ sourceKind: goodsReceipts.sourceKind, storageKey: goodsReceipts.storageKey, pageCount: goodsReceipts.pageCount })
            .from(goodsReceipts)
            .where(and(eq(goodsReceipts.id, docId), eq(goodsReceipts.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      default:
        return assertUnreachable(kind)
    }
    if (!row) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }
    return row
  }

  private async loadReviewDocument(
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
  ): Promise<ProcurementReviewDocument> {
    let row:
      | {
          id: string
          name: string
          status: ProcurementReviewDocument['status']
          sourceKind: string
          pageCount: number | null
          detectedKind: string | null
          reviewRequired: boolean
          reviewedAt: Date | null
          reviewedBy: string | null
        }
      | undefined
    switch (kind) {
      case 'purchase_order':
        row = (
          await db
            .select({
              id: purchaseOrders.id,
              name: purchaseOrders.name,
              status: purchaseOrders.status,
              sourceKind: purchaseOrders.sourceKind,
              pageCount: purchaseOrders.pageCount,
              detectedKind: purchaseOrders.detectedKind,
              reviewRequired: purchaseOrders.reviewRequired,
              reviewedAt: purchaseOrders.reviewedAt,
              reviewedBy: purchaseOrders.reviewedBy,
            })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.id, docId), eq(purchaseOrders.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      case 'invoice':
        row = (
          await db
            .select({
              id: invoices.id,
              name: invoices.name,
              status: invoices.status,
              sourceKind: invoices.sourceKind,
              pageCount: invoices.pageCount,
              detectedKind: invoices.detectedKind,
              reviewRequired: invoices.reviewRequired,
              reviewedAt: invoices.reviewedAt,
              reviewedBy: invoices.reviewedBy,
            })
            .from(invoices)
            .where(and(eq(invoices.id, docId), eq(invoices.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      case 'goods_receipt':
        row = (
          await db
            .select({
              id: goodsReceipts.id,
              name: goodsReceipts.name,
              status: goodsReceipts.status,
              sourceKind: goodsReceipts.sourceKind,
              pageCount: goodsReceipts.pageCount,
              detectedKind: goodsReceipts.detectedKind,
              reviewRequired: goodsReceipts.reviewRequired,
              reviewedAt: goodsReceipts.reviewedAt,
              reviewedBy: goodsReceipts.reviewedBy,
            })
            .from(goodsReceipts)
            .where(and(eq(goodsReceipts.id, docId), eq(goodsReceipts.workspaceId, workspaceId)))
            .limit(1)
        )[0]
        break
      default:
        return assertUnreachable(kind)
    }
    if (!row) {
      throw new NotFoundException(`${docLabel(kind)} not found`)
    }
    return {
      ...row,
      detectedKind: row.detectedKind as DetectedProcurementKind | null,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    }
  }

  private async selectLines(
    workspaceId: string,
    kind: ProcurementDocKind,
    docId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: ProcurementReviewLine[]; total: number }> {
    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    switch (kind) {
      case 'purchase_order': {
        const where = and(eq(poLineItems.workspaceId, workspaceId), eq(poLineItems.purchaseOrderId, docId))
        const [rows, [totalRow]] = await Promise.all([
          db
            .select({
              id: poLineItems.id,
              lineNumber: poLineItems.lineNumber,
              sku: poLineItems.sku,
              description: poLineItems.description,
              quantity: poLineItems.quantity,
              unitPrice: poLineItems.unitPrice,
              lineTotal: poLineItems.lineTotal,
              uom: poLineItems.uom,
              extractionConfidence: poLineItems.extractionConfidence,
              sourceKind: poLineItems.sourceKind,
              editedAt: poLineItems.editedAt,
              editedBy: poLineItems.editedBy,
            })
            .from(poLineItems)
            .where(where)
            .orderBy(asc(poLineItems.lineNumber), asc(poLineItems.id))
            .limit(limit)
            .offset(offset),
          db.select({ total: count() }).from(poLineItems).where(where),
        ])
        return {
          items: rows.map((r) => ({ ...r, extractionConfidence: toConfidence(r.extractionConfidence), editedAt: iso(r.editedAt) })),
          total: totalRow.total,
        }
      }
      case 'invoice': {
        const where = and(eq(invoiceLineItems.workspaceId, workspaceId), eq(invoiceLineItems.invoiceId, docId))
        const [rows, [totalRow]] = await Promise.all([
          db
            .select({
              id: invoiceLineItems.id,
              lineNumber: invoiceLineItems.lineNumber,
              sku: invoiceLineItems.sku,
              description: invoiceLineItems.description,
              quantity: invoiceLineItems.quantity,
              unitPrice: invoiceLineItems.unitPrice,
              lineTotal: invoiceLineItems.lineTotal,
              uom: invoiceLineItems.uom,
              extractionConfidence: invoiceLineItems.extractionConfidence,
              sourceKind: invoiceLineItems.sourceKind,
              editedAt: invoiceLineItems.editedAt,
              editedBy: invoiceLineItems.editedBy,
            })
            .from(invoiceLineItems)
            .where(where)
            .orderBy(asc(invoiceLineItems.lineNumber), asc(invoiceLineItems.id))
            .limit(limit)
            .offset(offset),
          db.select({ total: count() }).from(invoiceLineItems).where(where),
        ])
        return {
          items: rows.map((r) => ({ ...r, extractionConfidence: toConfidence(r.extractionConfidence), editedAt: iso(r.editedAt) })),
          total: totalRow.total,
        }
      }
      case 'goods_receipt': {
        const where = and(eq(goodsReceiptLineItems.workspaceId, workspaceId), eq(goodsReceiptLineItems.goodsReceiptId, docId))
        const [rows, [totalRow]] = await Promise.all([
          db
            .select({
              id: goodsReceiptLineItems.id,
              lineNumber: goodsReceiptLineItems.lineNumber,
              sku: goodsReceiptLineItems.sku,
              description: goodsReceiptLineItems.description,
              uom: goodsReceiptLineItems.uom,
              quantityReceived: goodsReceiptLineItems.quantityReceived,
              quantityAccepted: goodsReceiptLineItems.quantityAccepted,
              quantityRejected: goodsReceiptLineItems.quantityRejected,
              extractionConfidence: goodsReceiptLineItems.extractionConfidence,
              sourceKind: goodsReceiptLineItems.sourceKind,
              editedAt: goodsReceiptLineItems.editedAt,
              editedBy: goodsReceiptLineItems.editedBy,
            })
            .from(goodsReceiptLineItems)
            .where(where)
            .orderBy(asc(goodsReceiptLineItems.lineNumber), asc(goodsReceiptLineItems.id))
            .limit(limit)
            .offset(offset),
          db.select({ total: count() }).from(goodsReceiptLineItems).where(where),
        ])
        return {
          // A receipt has no price/total columns; the contract's quantity and
          // price fields are null so one line shape serves all three kinds.
          items: rows.map((r) => ({
            ...r,
            quantity: null,
            unitPrice: null,
            lineTotal: null,
            extractionConfidence: toConfidence(r.extractionConfidence),
            editedAt: iso(r.editedAt),
          })),
          total: totalRow.total,
        }
      }
      default:
        return assertUnreachable(kind)
    }
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
