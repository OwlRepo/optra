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
  ProcurementExtractionEmptyError,
  ProcurementExtractionRefusalError,
  ProcurementExtractionUnsupportedError,
} from '@repo/ai'
import { db, invoiceLineItems, invoices, poLineItems, purchaseOrders } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { isEmptyLineItem, mapRowToLineItem, validateLineItem } from './column-mapping'
import { pdfExtractionEnabled } from './procurement-feature-flags'
import { ProcurementDocKind, ProcurementParseService, RECONCILE_JOB_NAME } from './procurement-parse.service'
import { ProcurementExtractionService } from './procurement-extraction.service'

interface MappedLineItemRow {
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  rawRow: Record<string, unknown>
}

// 10 bound parameters per line row; 1,000 rows stays far below Postgres's
// 65,535 bind-parameter limit for a single INSERT.
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

// Document problems fail immediately. Everything else (storage, database,
// network, model timeout or malformed model output) is treated as transient
// and handed back to Bull, which retries with backoff.
function isPermanentParseError(error: unknown): boolean {
  return (
    error instanceof ProcurementParseInputError ||
    error instanceof ProcurementExtractionUnsupportedError ||
    error instanceof ProcurementExtractionEmptyError ||
    error instanceof ProcurementExtractionRefusalError
  )
}

// First sheet only (same as DatasetProfilingProcessor). Converted in memory:
// the stored original stays byte-for-byte what the user uploaded.
function convertXlsxToCsv(buffer: Buffer): string {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    throw new ProcurementParseInputError('Could not read this spreadsheet — it may be corrupt or password-protected')
  }
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return Papa.unparse(rows)
}

@Processor('procurement-parse-queue')
export class ProcurementParseProcessor {
  private readonly logger = new Logger(ProcurementParseProcessor.name)

  constructor(
    private readonly storage: StorageService,
    private readonly extraction: ProcurementExtractionService,
    private readonly parseService: ProcurementParseService,
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
      await this.markFailed(
        kind,
        id,
        `${kind === 'purchase_order' ? 'Purchase order' : 'Invoice'} is missing storageKey`,
      )
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

      tempPath = await this.storage.getToTempFile(doc.storageKey)

      let rows: MappedLineItemRow[]
      let sourceKind: string

      if (isPdf) {
        const result = await this.extraction.extract(tempPath)
        rows = result.items.map((item) => ({
          ...validateLineItem({
            sku: item.sku,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          }),
          rawRow: { ...item },
        }))
        sourceKind = 'pdf-extraction'
      } else {
        const isXlsx = extension === '.xlsx'
        const csvContent = isXlsx ? convertXlsxToCsv(await readFile(tempPath)) : await readFile(tempPath, 'utf-8')
        rows = this.parseCsvRows(csvContent)
        sourceKind = isXlsx ? 'xlsx' : 'csv'
      }

      await this.replaceLineItemsAndFinish(kind, id, doc.workspaceId, rows, sourceKind)

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

  private parseCsvRows(csvContent: string): MappedLineItemRow[] {
    const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true })

    // Broken quoting shifts every later cell into the wrong column, so the
    // rows cannot be trusted. A row with too few/many fields is tolerated —
    // vendor exports routinely carry trailing commas.
    const quoteError = parsed.errors.find((error) => error.type === 'Quotes')
    if (quoteError) {
      throw new ProcurementParseInputError(
        `The CSV file is malformed near row ${(quoteError.row ?? 0) + 2}: a quoted value is never closed`,
      )
    }

    return parsed.data
      .map((row) => ({ ...validateLineItem(mapRowToLineItem(row)), rawRow: row }))
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
      rawRow: row.rawRow,
      sourceKind,
    }))
    const done = { status: 'done' as const, rowCount: rows.length, lastError: null, updatedAt: new Date() }

    await db.transaction(async (tx) => {
      if (kind === 'purchase_order') {
        await tx.delete(poLineItems).where(eq(poLineItems.purchaseOrderId, id))
        for (let start = 0; start < lineValues.length; start += INSERT_CHUNK_ROWS) {
          await tx
            .insert(poLineItems)
            .values(lineValues.slice(start, start + INSERT_CHUNK_ROWS).map((value) => ({ ...value, purchaseOrderId: id })))
        }
        await tx.update(purchaseOrders).set(done).where(eq(purchaseOrders.id, id))
        return
      }

      await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))
      for (let start = 0; start < lineValues.length; start += INSERT_CHUNK_ROWS) {
        await tx
          .insert(invoiceLineItems)
          .values(lineValues.slice(start, start + INSERT_CHUNK_ROWS).map((value) => ({ ...value, invoiceId: id })))
      }
      await tx.update(invoices).set(done).where(eq(invoices.id, id))
    })
  }

  private async loadDoc(kind: ProcurementDocKind, id: string) {
    if (kind === 'purchase_order') {
      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
      return row
    }
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    return row
  }

  private async setProcessing(kind: ProcurementDocKind, id: string, processingStartedAt: Date) {
    const patch = {
      status: 'processing' as const,
      processingStartedAt,
      lastError: null,
      updatedAt: processingStartedAt,
    }
    if (kind === 'purchase_order') {
      await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id))
    } else {
      await db.update(invoices).set(patch).where(eq(invoices.id, id))
    }
  }

  private async markFailed(kind: ProcurementDocKind, id: string, lastError: string) {
    const patch = { status: 'failed' as const, lastError, updatedAt: new Date() }
    if (kind === 'purchase_order') {
      await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id))
    } else {
      await db.update(invoices).set(patch).where(eq(invoices.id, id))
    }
  }
}
