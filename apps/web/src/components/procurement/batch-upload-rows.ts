import type { ProcurementDocKind } from '@/lib/api/procurement'

// Pure logic behind the batch upload dialog: which files may be added, how they
// group into documents, and which header fields a row still lacks. Kept free of
// React so the rules are testable on their own.

export const MAX_BATCH_FILES = 5

export type BatchTab = ProcurementDocKind
export type BatchFileClass = 'csv' | 'xlsx' | 'pdf' | 'photo'
export type BatchRowStatus = 'ready' | 'uploading' | 'done' | 'error'

export type BatchRow = {
  id: string
  // 'file' is one CSV/XLSX/PDF. 'photos' is 1-5 photos of one paper document.
  kind: 'file' | 'photos'
  files: File[]
  // Text of every header input, keyed by field name. Trimmed on submit.
  header: Record<string, string>
  status: BatchRowStatus
  error?: string
}

export type AddFilesResult = { rows: BatchRow[]; error?: string }

// HEIC/HEIF count as photos here: the server refuses them with a message that
// tells the user how to export a JPEG, which beats a vague "unsupported file".
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])

export function classifyFile(file: File, tab: BatchTab): BatchFileClass | null {
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return null
  const extension = file.name.slice(dot + 1).toLowerCase()

  if (PHOTO_EXTENSIONS.has(extension)) return 'photo'
  if (extension === 'csv' || extension === 'xlsx') return extension
  // Goods receipts are CSV/XLSX or photos; a PDF has no reader on that path.
  if (extension === 'pdf' && tab !== 'goods-receipts') return 'pdf'
  return null
}

function newId(): string {
  return globalThis.crypto.randomUUID()
}

function defaultHeader(tab: BatchTab): Record<string, string> {
  // The old single-file modals defaulted PO and invoice currency to USD.
  return tab === 'goods-receipts' ? {} : { currency: 'USD' }
}

function newRow(kind: BatchRow['kind'], files: File[], tab: BatchTab): BatchRow {
  return { id: newId(), kind, files, header: defaultHeader(tab), status: 'ready' }
}

function countFiles(rows: BatchRow[]): number {
  return rows.reduce((sum, row) => sum + row.files.length, 0)
}

/**
 * Atomic: either every picked file is added or none is, with a message. A
 * partly-applied pick would leave the user guessing which files made it.
 * All photos in one pick become one photo row (one document, many pages).
 */
export function addFiles(rows: BatchRow[], picked: File[], tab: BatchTab): AddFilesResult {
  if (picked.length === 0) return { rows }

  const refused = picked.find((file) => classifyFile(file, tab) === null)
  if (refused) {
    const why = refused.name.toLowerCase().endsWith('.pdf') ? 'PDFs are not accepted for goods receipts' : 'unsupported file type'
    return { rows, error: `${refused.name}: ${why}` }
  }

  if (countFiles(rows) + picked.length > MAX_BATCH_FILES) {
    return { rows, error: `A batch holds at most ${MAX_BATCH_FILES} files — remove one first or upload in two batches` }
  }

  const fileRows = picked.filter((file) => classifyFile(file, tab) !== 'photo').map((file) => newRow('file', [file], tab))
  const photos = picked.filter((file) => classifyFile(file, tab) === 'photo')
  const photoRows = photos.length > 0 ? [newRow('photos', photos, tab)] : []

  return { rows: [...rows, ...fileRows, ...photoRows] }
}

// Every photo becomes its own document. Document numbers are cleared: two
// documents sharing one number would be a data error, not a convenience.
const DOCUMENT_NUMBERS = ['poNumber', 'invoiceNumber', 'grnNumber'] as const

export function splitPhotoRow(rows: BatchRow[], rowId: string): BatchRow[] {
  const target = rows.find((row) => row.id === rowId)
  if (!target || target.kind !== 'photos' || target.files.length < 2) return rows

  const header = { ...target.header }
  for (const field of DOCUMENT_NUMBERS) delete header[field]

  return rows.flatMap((row) =>
    row.id === rowId
      ? row.files.map((file): BatchRow => ({ id: newId(), kind: 'photos', files: [file], header: { ...header }, status: 'ready' }))
      : [row],
  )
}

const COPYABLE = ['vendorId', 'currency', 'purchaseOrderId', 'orderedAt'] as const

/** Copies the shared fields of row 1 to the others; never a document number, never a blank over a value. */
export function copyFromFirstRow(rows: BatchRow[]): BatchRow[] {
  if (rows.length < 2) return rows
  const [first, ...rest] = rows

  return [
    first,
    ...rest.map((row) => {
      const header = { ...row.header }
      for (const field of COPYABLE) {
        const value = first.header[field]
        if (value && value.trim() !== '') header[field] = value
      }
      return { ...row, header }
    }),
  ]
}

function blank(value: string | undefined): boolean {
  return !value || value.trim() === ''
}

/** Missing required header fields of one row, keyed by field name. */
export function rowErrors(row: BatchRow, tab: BatchTab): Record<string, string> {
  const errors: Record<string, string> = {}
  const need = (field: string, message: string) => {
    if (blank(row.header[field])) errors[field] = message
  }

  if (tab === 'purchase-orders') {
    need('vendorId', 'Choose a vendor')
    need('poNumber', 'Enter the PO number')
    need('currency', 'Enter a currency')
  } else if (tab === 'invoices') {
    need('purchaseOrderId', 'Choose a purchase order')
    need('invoiceNumber', 'Enter the invoice number')
    need('currency', 'Enter a currency')
  } else {
    need('purchaseOrderId', 'Choose a purchase order')
    need('grnNumber', 'Enter the goods receipt number')
  }
  return errors
}
