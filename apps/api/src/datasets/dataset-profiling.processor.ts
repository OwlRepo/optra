import { extname } from 'path'
import { readFile, unlink } from 'fs/promises'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { datasets, db, type DatasetColumn } from '@repo/db'
import { eq } from 'drizzle-orm'
import { StorageService } from '../storage/storage.service'

const SAMPLE_SIZE = 100

// XLSX is converted to CSV once, here, and the SAME storageKey is overwritten
// with the CSV bytes — DuckDbQueryService only ever needs to read CSV, so
// nothing downstream (query engine, text-to-SQL) has to know the original
// format. Only the first sheet is used: a query engine needs one clean table,
// not multiple sheets concatenated (unlike the RAG loader's `loadXLSX`, which
// joins every sheet as prose for embedding).
function convertXlsxToCsv(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return Papa.unparse(rows)
}

function inferColumnType(values: string[]): DatasetColumn['type'] {
  const sample = values.filter((value) => value !== undefined && value !== null && value !== '').slice(0, SAMPLE_SIZE)
  if (sample.length === 0) return 'string'
  if (sample.every((value) => /^-?\d+(\.\d+)?$/.test(value.trim()))) return 'number'
  if (sample.every((value) => /^\d{4}-\d{2}-\d{2}/.test(value.trim()))) return 'date'
  if (sample.every((value) => /^(true|false)$/i.test(value.trim()))) return 'boolean'
  return 'string'
}

function buildDescription(name: string, rowCount: number, columns: DatasetColumn[]): string {
  const columnList = columns.map((column) => `${column.name} (${column.type})`).join(', ')
  return `Dataset "${name}" with ${rowCount} rows and columns: ${columnList}.`
}

@Processor('dataset-profiling-queue')
export class DatasetProfilingProcessor {
  private readonly logger = new Logger(DatasetProfilingProcessor.name)

  constructor(private readonly storage: StorageService) {}

  @Process()
  async handleProfiling(job: Job<{ datasetId: string }>): Promise<void> {
    const { datasetId } = job.data
    const processingStartedAt = new Date()

    this.logger.log(`Dataset profiling start datasetId=${datasetId} jobId=${String(job.id)}`)

    await db
      .update(datasets)
      .set({ status: 'processing', processingStartedAt, lastError: null, updatedAt: processingStartedAt })
      .where(eq(datasets.id, datasetId))

    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1)

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`)
    }

    if (!dataset.storageKey) {
      await db
        .update(datasets)
        .set({ status: 'failed', lastError: 'Dataset is missing storageKey', updatedAt: new Date() })
        .where(eq(datasets.id, datasetId))
      return
    }

    let tempPath: string | undefined

    try {
      tempPath = await this.storage.getToTempFile(dataset.storageKey)
      const isXlsx = extname(dataset.name).toLowerCase() === '.xlsx'

      let csvContent: string
      if (isXlsx) {
        csvContent = convertXlsxToCsv(await readFile(tempPath))
        // Overwrite with the converted CSV so every later query against this
        // dataset (DuckDbQueryService.runReadOnlyQuery) reads plain CSV.
        await this.storage.save(dataset.storageKey, Buffer.from(csvContent, 'utf-8'), 'text/csv')
      } else {
        csvContent = await readFile(tempPath, 'utf-8')
      }

      const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true })

      const headers = parsed.meta.fields ?? []
      const columns: DatasetColumn[] = headers.map((header) => ({
        name: header,
        type: inferColumnType(parsed.data.map((row) => row[header])),
      }))
      const rowCount = parsed.data.length
      const description = buildDescription(dataset.name, rowCount, columns)

      const { embedQuery } = await import('@repo/ai')
      const descriptionEmbedding = await embedQuery(description)

      await db
        .update(datasets)
        .set({
          status: 'done',
          columnsSchema: columns,
          rowCount,
          description,
          descriptionEmbedding,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(datasets.id, datasetId))

      this.logger.log(`Dataset profiling completed datasetId=${datasetId} jobId=${String(job.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Dataset profiling failed for dataset ${datasetId}`, error instanceof Error ? error.stack : message)
      await db
        .update(datasets)
        .set({ status: 'failed', lastError: message, updatedAt: new Date() })
        .where(eq(datasets.id, datasetId))
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }
}
