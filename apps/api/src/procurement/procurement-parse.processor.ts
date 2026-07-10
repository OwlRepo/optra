import { extname } from 'path'
import { readFile, unlink } from 'fs/promises'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { db, invoiceLineItems, invoices, poLineItems, purchaseOrders } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { mapRowToLineItem } from './column-mapping'
import { ProcurementDocKind } from './procurement-parse.service'
import { ProcurementExtractionService } from './procurement-extraction.service'

interface MappedLineItemRow {
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  rawRow: Record<string, unknown>
}

// Mirrors DatasetProfilingProcessor's XLSX->CSV conversion exactly (first
// sheet only) — DuckDbQueryService (used later, in comparison.service.ts)
// only ever reads CSV.
function convertXlsxToCsv(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
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
  ) {}

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
      tempPath = await this.storage.getToTempFile(doc.storageKey)
      const isPdf = extname(doc.name).toLowerCase() === '.pdf'

      let rows: MappedLineItemRow[]
      let sourceKind: string

      if (isPdf) {
        const result = await this.extraction.extract(tempPath)
        rows = result.items.map((item) => ({
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          rawRow: { ...item },
        }))
        sourceKind = 'pdf-extraction'
      } else {
        const isXlsx = extname(doc.name).toLowerCase() === '.xlsx'
        let csvContent: string
        if (isXlsx) {
          csvContent = convertXlsxToCsv(await readFile(tempPath))
          // Overwrite with the converted CSV so every later read of this
          // storageKey (comparison.service.ts export step) sees plain CSV.
          await this.storage.save(doc.storageKey, Buffer.from(csvContent, 'utf-8'), 'text/csv')
        } else {
          csvContent = await readFile(tempPath, 'utf-8')
        }

        const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true })
        rows = parsed.data.map((row) => ({ ...mapRowToLineItem(row), rawRow: row }))
        sourceKind = 'csv'
      }

      await this.replaceLineItems(kind, id, doc.workspaceId, rows, sourceKind)
      await this.setDone(kind, id, rows.length)

      this.logger.log(`Procurement parse completed kind=${kind} id=${id} jobId=${String(job.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Procurement parse failed for ${kind} ${id}`, error instanceof Error ? error.stack : message)
      await this.markFailed(kind, id, message)
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }

  // Delete-then-insert makes a retried job (Bull attempts:3, or a manual
  // re-upload) idempotent — a partial insert from a prior failed attempt
  // never doubles up against the fresh parse. Rows arrive pre-mapped (CSV
  // rows via mapRowToLineItem, PDF rows via the extraction chain) so this
  // method is agnostic to source format.
  private async replaceLineItems(
    kind: ProcurementDocKind,
    id: string,
    workspaceId: string,
    rows: MappedLineItemRow[],
    sourceKind: string,
  ) {
    if (kind === 'purchase_order') {
      await db.delete(poLineItems).where(eq(poLineItems.purchaseOrderId, id))
      if (rows.length > 0) {
        await db.insert(poLineItems).values(
          rows.map((row, index) => ({
            workspaceId,
            purchaseOrderId: id,
            lineNumber: index + 1,
            sku: row.sku,
            description: row.description,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            lineTotal: row.lineTotal,
            rawRow: row.rawRow,
            sourceKind,
          })),
        )
      }
      return
    }

    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))
    if (rows.length > 0) {
      await db.insert(invoiceLineItems).values(
        rows.map((row, index) => ({
          workspaceId,
          invoiceId: id,
          lineNumber: index + 1,
          sku: row.sku,
          description: row.description,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
          rawRow: row.rawRow,
          sourceKind,
        })),
      )
    }
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

  private async setDone(kind: ProcurementDocKind, id: string, rowCount: number) {
    const patch = { status: 'done' as const, rowCount, lastError: null, updatedAt: new Date() }
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
