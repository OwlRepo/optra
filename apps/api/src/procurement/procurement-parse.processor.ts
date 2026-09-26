import { randomUUID } from 'crypto'
import { extname } from 'path'
import { readFile, unlink } from 'fs/promises'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import {
  EXTRACTOR_VERSION,
  ProcurementExtractionEmptyError,
  ProcurementExtractionRefusalError,
  ProcurementExtractionUnsupportedError,
} from '@repo/ai'
import { db, goodsReceiptLineItems, goodsReceipts, invoiceLineItems, invoices, poLineItems, purchaseOrders } from '@repo/db'
import { isBudgetExceeded } from '../limits/usage.service'
import { StorageService } from '../storage/storage.service'
import { StorageObjectNotFoundError } from '../storage/storage.errors'
import { isEmptyLineItem, mapRowToLineItem, receivedQuantity, validateLineItem } from './column-mapping'
import { pdfExtractionEnabled } from './procurement-feature-flags'
import { ProcurementDocKind, ProcurementParseService, RECONCILE_JOB_NAME } from './procurement-parse.service'
import { ProcurementCompareService } from './procurement-compare.service'
import { assertUnreachable, docLabel } from './procurement-kind'
import { ProcurementExtractionService } from './procurement-extraction.service'

interface MappedLineItemRow {
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  uom: string | null
  // Goods receipt only (S5); null on a purchase order or invoice row. Null is
  // never zero — a source that did not state acceptance must not be read as
  // "nothing accepted" (POLICY v1 #14, §1B).
  quantityReceived: string | null
  quantityAccepted: string | null
  quantityRejected: string | null
  rawRow: Record<string, unknown>
  // Provenance (S3a). Which of these is knowable depends on the source: a
  // spreadsheet knows where the row sat, a PDF knows how sure the model was.
  sourceRow: number | null
  sourceSheet: string | null
  extractionConfidence: string | null
  extractorVersion: string | null
}

// 15 bound parameters per line row since S3a added provenance; 1,000 rows is
// 15,000 parameters, still far below Postgres's 65,535 limit for one INSERT.
const INSERT_CHUNK_ROWS = 1_000

// A problem with the document itself. Retrying cannot fix it, so the worker
// fails the document at once and tells the user exactly why (the message is
// authored here, never derived from cell content).
export class ProcurementParseInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcurementParseInputError'
  }
}

// Document problems fail immediately - and so does a source file that is gone
// from storage. Everything else (storage outages, database, network, model
// timeout or malformed model output) is treated as transient
// and handed back to Bull, which retries with backoff.
function isPermanentParseError(error: unknown): boolean {
  return (
    error instanceof ProcurementParseInputError ||
    // The monthly budget will not refill before a Bull retry fires.
    isBudgetExceeded(error) ||
    error instanceof ProcurementExtractionUnsupportedError ||
    error instanceof ProcurementExtractionEmptyError ||
    error instanceof ProcurementExtractionRefusalError ||
    // The file is not in storage; a retry will not put it there. Its message
    // is constant and key-free, so it is safe to show as lastError.
    error instanceof StorageObjectNotFoundError
  )
}

// First sheet only (same as DatasetProfilingProcessor). Converted in memory:
// the stored original stays byte-for-byte what the user uploaded.
function convertXlsxToCsv(buffer: Buffer): { csv: string; sheetName: string | null } {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    throw new ProcurementParseInputError('Could not read this spreadsheet — it may be corrupt or password-protected')
  }
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return { csv: Papa.unparse(rows), sheetName: firstSheetName ?? null }
}

@Processor('procurement-parse-queue')
export class ProcurementParseProcessor {
  private readonly logger = new Logger(ProcurementParseProcessor.name)

  constructor(
    private readonly storage: StorageService,
    private readonly extraction: ProcurementExtractionService,
    private readonly parseService: ProcurementParseService,
    private readonly compareService: ProcurementCompareService,
  ) {}

  @Process(RECONCILE_JOB_NAME)
  async handleReconcile(): Promise<void> {
    await this.parseService.reconcile()
  }

  @Process()
  async handleParse(job: Job<{ kind: ProcurementDocKind; id: string }>): Promise<void> {
    const { kind, id } = job.data
    const processingStartedAt = new Date()

    this.logger.log(`Procurement parse start kind=${kind} id=${id} jobId=${String(job.id)}`)

    await this.setProcessing(kind, id, processingStartedAt)

    const doc = await this.loadDoc(kind, id)

    if (!doc) {
      throw new Error(`${kind} not found: ${id}`)
    }

    if (!doc.storageKey) {
      await this.markFailed(kind, id, `${docLabel(kind)} is missing storageKey`)
      return
    }

    let tempPath: string | undefined

    try {
      const extension = extname(doc.name).toLowerCase()
      const isPdf = extension === '.pdf'

      // The upload filter checks this flag too, but a PDF queued before the
      // flag was turned off must not reach the model afterwards.
      if (isPdf && !pdfExtractionEnabled()) {
        throw new ProcurementParseInputError('PDF extraction is not enabled')
      }

      // Same reasoning as the upload filter, repeated here because the two can
      // disagree: the extraction chain has no received/accepted/rejected in its
      // result shape, so a PDF receipt would land a single quantity and lose
      // the acceptance data silently. Refusing is the honest outcome.
      if (isPdf && kind === 'goods_receipt') {
        throw new ProcurementParseInputError('Goods receipts must be CSV or XLSX; PDF is not supported yet')
      }

      tempPath = await this.storage.getToTempFile(doc.storageKey)

      let rows: MappedLineItemRow[]
      let sourceKind: string

      if (isPdf) {
        const result = await this.extraction.extract(tempPath, doc.workspaceId)
        rows = result.items.map((item) => ({
          ...validateLineItem({
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            // The model is not asked for a unit of measure.
            uom: null,
          }),
          rawRow: { ...item },
          // A PDF has no spreadsheet coordinates; what it does have is the
          // model's own confidence, which until now only survived inside rawRow.
          sourceRow: null,
          sourceSheet: null,
          extractionConfidence: item.confidence === null ? null : String(item.confidence),
          extractorVersion: EXTRACTOR_VERSION,
        }))
        sourceKind = 'pdf-extraction'
      } else {
        const isXlsx = extension === '.xlsx'
        const converted = isXlsx ? convertXlsxToCsv(await readFile(tempPath)) : null
        const csvContent = converted ? converted.csv : await readFile(tempPath, 'utf-8')
        rows = this.parseCsvRows(csvContent, converted?.sheetName ?? null)
        sourceKind = isXlsx ? 'xlsx' : 'csv'
      }

      await this.replaceLineItemsAndFinish(kind, id, doc.workspaceId, rows, sourceKind)

      // S8. The document is already `done` before this runs, and the failure is
      // swallowed, because a queue that will not take the follow-up work is not
      // this document's problem — reporting it as a parse failure would make a
      // correctly parsed file look unreadable to its owner. Same discipline as
      // every `EventsService.record` caller.
      //
      // The feature flag is checked inside `enqueueForDocument`, not here. One
      // check, in the place that owns the behaviour, rather than two places to
      // remember; it returns before touching the database when the flag is off.
      await this.compareService
        .enqueueForDocument(kind, id)
        .catch((error: unknown) =>
          this.logger.warn(
            `Auto-compare enqueue failed kind=${kind} id=${id}: ` +
              `${error instanceof Error ? error.message : 'unknown error'}`,
          ),
        )

      this.logger.log(`Procurement parse completed kind=${kind} id=${id} jobId=${String(job.id)}`)
    } catch (error) {
      await this.handleFailure(job, error)
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }

  // Document problems fail now and return (Bull records success, no retry).
  // Transient problems are rethrown so Bull retries; only the final attempt
  // writes `failed`, so an attempt that will be retried never shows as failed.
  // lastError is always client-safe: an authored document message, or a
  // reference id that matches the full detail in this log line.
  private async handleFailure(job: Job<{ kind: ProcurementDocKind; id: string }>, error: unknown) {
    const { kind, id } = job.data
    const permanent = isPermanentParseError(error)
    const attempt = (job.attemptsMade ?? 0) + 1
    const attempts = job.opts?.attempts ?? 1
    const finalAttempt = attempt >= attempts
    const reference = randomUUID().slice(0, 8)

    this.logger.error(
      `Procurement parse failed kind=${kind} id=${id} jobId=${String(job.id)} ref=${reference} ` +
        `attempt=${attempt}/${attempts} permanent=${permanent}`,
      error instanceof Error ? error.stack : String(error),
    )

    if (permanent) {
      await this.markFailed(kind, id, (error as Error).message)
      return
    }

    if (finalAttempt) {
      await this.markFailed(kind, id, `Parsing failed. Reference: ${reference}`)
    }
    throw error
  }

  private parseCsvRows(csvContent: string, sourceSheet: string | null): MappedLineItemRow[] {
    // skipEmptyLines is off on purpose: with it on, Papa collapses the array and
    // a row's index no longer corresponds to its line in the file, which is the
    // whole point of sourceRow. Blank rows are dropped below by isEmptyLineItem
    // instead, so the resulting line set is unchanged.
    const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: false })

    // Broken quoting shifts every later cell into the wrong column, so the
    // rows cannot be trusted. A row with too few/many fields is tolerated —
    // vendor exports routinely carry trailing commas.
    const quoteError = parsed.errors.find((error) => error.type === 'Quotes')
    if (quoteError) {
      throw new ProcurementParseInputError(
        `The CSV file is malformed near row ${(quoteError.row ?? 0) + 2}: a quoted value is never closed`,
      )
    }

    // The index is captured here, before the empty-row filter: afterwards the
    // position in the file is unrecoverable. Papa consumes the header, so the
    // file's 1-based row is index + 2.
    return parsed.data
      .map((row, index) => ({
        ...validateLineItem(mapRowToLineItem(row)),
        rawRow: row,
        sourceRow: index + 2,
        sourceSheet,
        extractionConfidence: null,
        extractorVersion: null,
      }))
      .filter((row) => !isEmptyLineItem(row))
  }

  // One transaction for delete + chunked insert + `done`: a retried or
  // concurrent attempt can never leave a document marked done with a partial
  // or empty line set.
  private async replaceLineItemsAndFinish(
    kind: ProcurementDocKind,
    id: string,
    workspaceId: string,
    rows: MappedLineItemRow[],
    sourceKind: string,
  ) {
    const lineValues = rows.map((row, index) => ({
      workspaceId,
      lineNumber: index + 1,
      sku: row.sku,
      description: row.description,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      lineTotal: row.lineTotal,
      uom: row.uom,
      quantityReceived: receivedQuantity(row),
      quantityAccepted: row.quantityAccepted ?? null,
      quantityRejected: row.quantityRejected ?? null,
      rawRow: row.rawRow,
      sourceKind,
      sourceRow: row.sourceRow,
      sourceSheet: row.sourceSheet,
      extractionConfidence: row.extractionConfidence,
      extractorVersion: row.extractorVersion,
    }))
    const done = { status: 'done' as const, rowCount: rows.length, lastError: null, updatedAt: new Date() }

    await db.transaction(async (tx) => {
      switch (kind) {
        case 'purchase_order': {
          await tx.delete(poLineItems).where(eq(poLineItems.purchaseOrderId, id))
          for (let start = 0; start < lineValues.length; start += INSERT_CHUNK_ROWS) {
            await tx.insert(poLineItems).values(
              lineValues.slice(start, start + INSERT_CHUNK_ROWS).map((value) => ({ ...value, purchaseOrderId: id })),
            )
          }
          await tx.update(purchaseOrders).set(done).where(eq(purchaseOrders.id, id))
          break
        }
        case 'invoice': {
          await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))
          for (let start = 0; start < lineValues.length; start += INSERT_CHUNK_ROWS) {
            await tx.insert(invoiceLineItems).values(
              lineValues.slice(start, start + INSERT_CHUNK_ROWS).map((value) => ({ ...value, invoiceId: id })),
            )
          }
          await tx.update(invoices).set(done).where(eq(invoices.id, id))
          break
        }
        case 'goods_receipt': {
          // A receipt's line table has no quantity/unitPrice/lineTotal and no
          // PDF provenance, so the shared `lineValues` shape is mapped here
          // rather than weakened for every kind. `receivedQuantity` falls back
          // to a plain "Qty" column, which on a receipt means received.
          await tx.delete(goodsReceiptLineItems).where(eq(goodsReceiptLineItems.goodsReceiptId, id))
          for (let start = 0; start < lineValues.length; start += INSERT_CHUNK_ROWS) {
            await tx.insert(goodsReceiptLineItems).values(
              lineValues.slice(start, start + INSERT_CHUNK_ROWS).map((value) => ({
                workspaceId: value.workspaceId,
                goodsReceiptId: id,
                lineNumber: value.lineNumber,
                sku: value.sku,
                description: value.description,
                quantityReceived: value.quantityReceived,
                quantityAccepted: value.quantityAccepted,
                quantityRejected: value.quantityRejected,
                uom: value.uom,
                rawRow: value.rawRow,
                sourceKind: value.sourceKind,
                sourceRow: value.sourceRow,
                sourceSheet: value.sourceSheet,
              })),
            )
          }
          await tx.update(goodsReceipts).set(done).where(eq(goodsReceipts.id, id))
          break
        }
        default:
          assertUnreachable(kind)
      }
    })
  }

  private async loadDoc(kind: ProcurementDocKind, id: string) {
    switch (kind) {
      case 'purchase_order': {
        const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
        return row
      }
      case 'invoice': {
        const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
        return row
      }
      case 'goods_receipt': {
        const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1)
        return row
      }
      default:
        return assertUnreachable(kind)
    }
  }

  private async setProcessing(kind: ProcurementDocKind, id: string, processingStartedAt: Date) {
    const patch = {
      status: 'processing' as const,
      processingStartedAt,
      lastError: null,
      updatedAt: processingStartedAt,
    }
    await this.patchHeader(kind, id, patch)
  }

  private async markFailed(kind: ProcurementDocKind, id: string, lastError: string) {
    await this.patchHeader(kind, id, { status: 'failed' as const, lastError, updatedAt: new Date() })
  }

  // One place that maps a kind to its header table, so setProcessing and
  // markFailed cannot drift apart when a kind is added.
  private async patchHeader(
    kind: ProcurementDocKind,
    id: string,
    patch: Partial<{ status: 'pending' | 'processing' | 'done' | 'failed'; lastError: string | null; processingStartedAt: Date | null; updatedAt: Date }>,
  ) {
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
