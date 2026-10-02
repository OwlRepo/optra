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
import { createLimit, renderPdfToImages } from '@repo/ai'
import { isBudgetExceeded } from '../limits/usage.service'
import { MAX_SKU_LENGTH } from '../procurement/column-mapping'
import { StorageService } from '../storage/storage.service'
import { StorageObjectNotFoundError } from '../storage/storage.errors'
import { CatalogExtractionService } from './catalog-extraction.service'
import { CatalogImageService } from './catalog-image.service'
import { CATALOG_RECONCILE_JOB_NAME, CatalogParseService } from './catalog-parse.service'

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

// A parse attempt has 5 minutes (PARSE_JOB_TIMEOUT_MS) and one photo fetch can
// take 20 s before it times out. Fetching a few at a time, and starting none
// after this budget, keeps every attempt inside its timeout however many
// photos the catalog lists; a photo not fetched is stored as no photo, the
// same as one whose fetch failed.
const PHOTO_FETCH_CONCURRENCY = 4
const PHOTO_PHASE_BUDGET_MS = 3 * 60_000

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

// An item needs something to match on: catalog matching searches by SKU or
// description, so a row with neither is not an item (B4).
// A SKU too long for the column counts as none: replaceItems stores it as
// null (B5), so a row with nothing else would still be an empty item.
function describesAnItem(row: { sku: string | null; description: string | null }): boolean {
  const sku = row.sku?.trim()
  return Boolean((sku && row.sku!.length <= MAX_SKU_LENGTH) || row.description?.trim())
}

function mapRowToCatalogRow(row: Record<string, string>): MappedCatalogRow {
  return {
    sku: findValue(row, SKU_ALIASES),
    description: findValue(row, DESCRIPTION_ALIASES),
    photoUrl: findValue(row, PHOTO_URL_ALIASES),
    rawRow: row,
  }
}

// A problem with the catalog file itself: retrying cannot fix it, so the
// worker fails the catalog at once instead of handing it back to Bull.
// B17. A catalog with no item in it fails at parse with a reason, the rule
// procurement files follow (NO_LINE_ITEMS_MESSAGE); `done` with 0 items read as
// success and matching simply found nothing.
export const NO_CATALOG_ITEMS_MESSAGE =
  'No catalog items were found in this file. Its first row must hold column headers such as SKU and Description, and it must be saved as a UTF-8 CSV or an XLSX workbook.'
export const NO_PDF_CATALOG_ITEMS_MESSAGE =
  'No catalog items could be read from this PDF. Check that its pages show product SKUs or descriptions as text or clear images.'

export class CatalogParseInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogParseInputError'
  }
}

// Converted in memory: the stored original stays what the vendor uploaded.
function convertXlsxToCsv(buffer: Buffer): string {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    throw new CatalogParseInputError('Could not read this spreadsheet — it may be corrupt or password-protected')
  }
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
    private readonly parseService: CatalogParseService,
  ) {}

  @Process(CATALOG_RECONCILE_JOB_NAME)
  async handleReconcile(): Promise<void> {
    await this.parseService.reconcile()
  }

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
      // File problems fail now (no retry). Anything else is handed back to
      // Bull to retry with backoff; only the final attempt records `failed`.
      const message = error instanceof Error ? error.message : String(error)
      const attempt = (job.attemptsMade ?? 0) + 1
      const attempts = job.opts?.attempts ?? 1
      // A missing object is permanent too: a retry cannot bring the file back.
      const permanent =
        error instanceof CatalogParseInputError ||
        isBudgetExceeded(error) ||
        error instanceof StorageObjectNotFoundError
      this.logger.error(
        `Catalog parse failed for ${id} attempt=${attempt}/${attempts} permanent=${permanent}`,
        error instanceof Error ? error.stack : message,
      )
      if (permanent) {
        await this.markFailed(id, message)
        return
      }
      if (attempt >= attempts) {
        await this.markFailed(id, message)
      }
      throw error
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
    let rendered: Awaited<ReturnType<typeof renderPdfToImages>>
    try {
      rendered = await renderPdfToImages(buffer)
    } catch {
      throw new CatalogParseInputError('Could not read this PDF — it may be corrupt or empty')
    }

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
        const result = await this.extraction.extractFromImage(pageImage, workspaceId)
        items = result.items
      } catch (error) {
        // One unreadable page is skipped; an exhausted budget stops the whole
        // catalog, or every remaining page would be refused one by one.
        if (isBudgetExceeded(error)) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Catalog page extraction failed catalogId=${catalogId} page=${pageNumber}: ${message}`)
        continue
      }

      for (const item of items.filter(describesAnItem)) {
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

    if (rows.length === 0) {
      throw new CatalogParseInputError(NO_PDF_CATALOG_ITEMS_MESSAGE)
    }
    await this.replaceItems(catalogId, workspaceId, rows)
    return rows.length
  }

  private async parseSpreadsheet(catalog: Catalog, tempPath: string): Promise<number> {
    const isXlsx = extname(catalog.name).toLowerCase() === '.xlsx'
    let csvContent: string

    if (isXlsx) {
      csvContent = convertXlsxToCsv(await readFile(tempPath))
    } else {
      csvContent = await readFile(tempPath, 'utf-8')
    }

    const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true })
    // B4. A ",,"-only row (or one with values only in unmapped columns)
    // describes nothing; it is dropped before any photo is fetched for it.
    const mapped = parsed.data.map((row) => mapRowToCatalogRow(row)).filter(describesAnItem)
    if (mapped.length === 0) {
      throw new CatalogParseInputError(NO_CATALOG_ITEMS_MESSAGE)
    }

    const limit = createLimit(PHOTO_FETCH_CONCURRENCY)
    const deadline = Date.now() + PHOTO_PHASE_BUDGET_MS
    let photosSkipped = 0
    // fetchAndStore never rejects (a failed fetch is null), so Promise.all
    // cannot be cut short by one bad photo.
    const photoKeys = await Promise.all(
      mapped.map((row) =>
        row.photoUrl
          ? limit(async () => {
              if (Date.now() >= deadline) {
                photosSkipped += 1
                return null
              }
              return this.images.fetchAndStore(catalog.workspaceId, catalog.id, row.photoUrl as string)
            })
          : null,
      ),
    )
    if (photosSkipped > 0) {
      this.logger.warn(`Catalog photo budget spent id=${catalog.id}: ${photosSkipped} photo(s) not fetched`)
    }

    const rows: ItemToInsert[] = mapped.map((row, index) => ({
      lineNumber: index + 1,
      sku: row.sku,
      description: row.description,
      photoStorageKey: photoKeys[index],
      sourcePageNumber: null,
      rawRow: row.rawRow,
    }))

    await this.replaceItems(catalog.id, catalog.workspaceId, rows)
    return rows.length
  }

  // Delete-then-insert makes a retried job (Bull attempts:3, which now really
  // retries transient failures) idempotent. Both parse paths (spreadsheet and
  // PDF) funnel through here, so the column limits are enforced once.
  private async replaceItems(catalogId: string, workspaceId: string, rows: ItemToInsert[]) {
    await db.delete(catalogItems).where(eq(catalogItems.catalogId, catalogId))

    if (rows.length > 0) {
      await db.insert(catalogItems).values(
        rows.map((row) => ({
          workspaceId,
          catalogId,
          lineNumber: row.lineNumber,
          // catalog_items.sku is varchar(200). One SKU it cannot hold must not
          // fail the whole catalog: the item keeps no SKU (rawRow keeps the
          // vendor's text), as procurement's validateLineItem does.
          sku: row.sku !== null && row.sku.length <= MAX_SKU_LENGTH ? row.sku : null,
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
