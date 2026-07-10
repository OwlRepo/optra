import { randomUUID } from 'crypto'
import { extname } from 'path'
import { readFile, unlink } from 'fs/promises'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { Catalog, catalogItems, catalogs, db } from '@repo/db'
import { renderPdfToImages } from '@repo/ai'
import { StorageService } from '../storage/storage.service'
import { CatalogExtractionService } from './catalog-extraction.service'
import { CatalogImageService } from './catalog-image.service'

interface MappedCatalogRow {
  sku: string | null
  description: string | null
  photoUrl: string | null
  rawRow: Record<string, unknown>
}

interface ItemToInsert {
  lineNumber: number
  sku: string | null
  description: string | null
  photoStorageKey: string | null
  sourcePageNumber: number | null
  rawRow: Record<string, unknown>
}

const SKU_ALIASES = ['sku', 'item', 'item code', 'itemcode', 'product code', 'productcode']
const DESCRIPTION_ALIASES = ['description', 'desc', 'item name', 'itemname', 'name', 'product', 'product name']
const PHOTO_URL_ALIASES = ['photo_url', 'photo url', 'image_url', 'image url', 'photo', 'image']

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase()
}

// Same alias-list approach as procurement's column-mapping.ts (vendor files
// spell "SKU" vs "Item Code" differently) — scoped to the 3 fields a
// catalog row can carry, since catalog items have no quantity/price.
function findValue(row: Record<string, string>, aliases: string[]): string | null {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value] as const)

  for (const alias of aliases) {
    const match = normalizedEntries.find(([key]) => key === alias)
    if (match && match[1] !== undefined && match[1].trim() !== '') {
      return match[1].trim()
    }
  }

  return null
}

function mapRowToCatalogRow(row: Record<string, string>): MappedCatalogRow {
  return {
    sku: findValue(row, SKU_ALIASES),
    description: findValue(row, DESCRIPTION_ALIASES),
    photoUrl: findValue(row, PHOTO_URL_ALIASES),
    rawRow: row,
  }
}

function convertXlsxToCsv(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return Papa.unparse(rows)
}

@Processor('catalog-parse-queue')
export class CatalogParseProcessor {
  private readonly logger = new Logger(CatalogParseProcessor.name)

  constructor(
    private readonly storage: StorageService,
    private readonly extraction: CatalogExtractionService,
    private readonly images: CatalogImageService,
  ) {}

  @Process()
  async handleParse(job: Job<{ id: string }>): Promise<void> {
    const { id } = job.data
    const processingStartedAt = new Date()

    this.logger.log(`Catalog parse start id=${id} jobId=${String(job.id)}`)

    await this.setProcessing(id, processingStartedAt)

    const catalog = await this.loadCatalog(id)

    if (!catalog) {
      throw new Error(`catalog not found: ${id}`)
    }

    if (!catalog.storageKey) {
      await this.markFailed(id, 'Catalog is missing storageKey')
      return
    }

    let tempPath: string | undefined

    try {
      tempPath = await this.storage.getToTempFile(catalog.storageKey)
      const isPdf = extname(catalog.name).toLowerCase() === '.pdf'

      const rowCount = isPdf
        ? await this.parsePdf(catalog.workspaceId, id, tempPath)
        : await this.parseSpreadsheet(catalog, tempPath)

      await this.setDone(id, rowCount)
      this.logger.log(`Catalog parse completed id=${id} jobId=${String(job.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Catalog parse failed for ${id}`, error instanceof Error ? error.stack : message)
      await this.markFailed(id, message)
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }

  // PDF item photo is the page image (A3 decision #5, page-granularity):
  // every item extracted from page N shares page N's stored image as its
  // photoStorageKey — pages are stored once, not once per item.
  private async parsePdf(workspaceId: string, catalogId: string, tempPath: string): Promise<number> {
    const buffer = await readFile(tempPath)
    const rendered = await renderPdfToImages(buffer)

    if (rendered.truncated) {
      this.logger.warn(
        `Catalog parse truncated catalogId=${catalogId} total=${rendered.total} rendered=${rendered.pages.length}`,
      )
    }

    const rows: ItemToInsert[] = []
    let lineNumber = 0

    for (let pageIndex = 0; pageIndex < rendered.pages.length; pageIndex += 1) {
      const pageNumber = pageIndex + 1
      const pageImage = rendered.pages[pageIndex]
      const pageKey = `${workspaceId}/catalogs/${catalogId}/pages/${randomUUID()}.png`
      await this.storage.save(pageKey, pageImage, 'image/png')

      let items: { sku: string | null; description: string | null }[] = []
      try {
        const result = await this.extraction.extractFromImage(pageImage)
        items = result.items
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Catalog page extraction failed catalogId=${catalogId} page=${pageNumber}: ${message}`)
        continue
      }

      for (const item of items) {
        lineNumber += 1
        rows.push({
          lineNumber,
          sku: item.sku,
          description: item.description,
          photoStorageKey: pageKey,
          sourcePageNumber: pageNumber,
          rawRow: { ...item, sourcePageNumber: pageNumber },
        })
      }
    }

    await this.replaceItems(catalogId, workspaceId, rows)
    return rows.length
  }

  private async parseSpreadsheet(catalog: Catalog, tempPath: string): Promise<number> {
    const isXlsx = extname(catalog.name).toLowerCase() === '.xlsx'
    let csvContent: string

    if (isXlsx) {
      csvContent = convertXlsxToCsv(await readFile(tempPath))
      await this.storage.save(catalog.storageKey as string, Buffer.from(csvContent, 'utf-8'), 'text/csv')
    } else {
      csvContent = await readFile(tempPath, 'utf-8')
    }

    const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true })
    const mapped = parsed.data.map((row) => mapRowToCatalogRow(row))

    const rows: ItemToInsert[] = []
    let lineNumber = 0

    for (const row of mapped) {
      lineNumber += 1
      const photoStorageKey = row.photoUrl
        ? await this.images.fetchAndStore(catalog.workspaceId, catalog.id, row.photoUrl)
        : null

      rows.push({
        lineNumber,
        sku: row.sku,
        description: row.description,
        photoStorageKey,
        sourcePageNumber: null,
        rawRow: row.rawRow,
      })
    }

    await this.replaceItems(catalog.id, catalog.workspaceId, rows)
    return rows.length
  }

  // Delete-then-insert makes a retried job (Bull attempts:3) idempotent —
  // same idiom as ProcurementParseProcessor#replaceLineItems.
  private async replaceItems(catalogId: string, workspaceId: string, rows: ItemToInsert[]) {
    await db.delete(catalogItems).where(eq(catalogItems.catalogId, catalogId))

    if (rows.length > 0) {
      await db.insert(catalogItems).values(
        rows.map((row) => ({
          workspaceId,
          catalogId,
          lineNumber: row.lineNumber,
          sku: row.sku,
          description: row.description,
          photoStorageKey: row.photoStorageKey,
          sourcePageNumber: row.sourcePageNumber,
          rawRow: row.rawRow,
        })),
      )
    }
  }

  private async loadCatalog(id: string) {
    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1)
    return row
  }

  private async setProcessing(id: string, processingStartedAt: Date) {
    await db
      .update(catalogs)
      .set({ status: 'processing', processingStartedAt, lastError: null, updatedAt: processingStartedAt })
      .where(eq(catalogs.id, id))
  }

  private async setDone(id: string, rowCount: number) {
    await db
      .update(catalogs)
      .set({ status: 'done', rowCount, lastError: null, updatedAt: new Date() })
      .where(eq(catalogs.id, id))
  }

  private async markFailed(id: string, lastError: string) {
    await db.update(catalogs).set({ status: 'failed', lastError, updatedAt: new Date() }).where(eq(catalogs.id, id))
  }
}
