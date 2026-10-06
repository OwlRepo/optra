/**
 * Where a discrepancy flag's line came from (slice S2, citations).
 *
 * Every field is nullable by provenance, not by accident: CSV/XLSX know the
 * row (XLSX also the sheet) but have no model confidence; a PDF is the
 * reverse. There is NO page number, by design: the extraction chain prompts
 * over the whole document, so no honest page exists (poLineItems.ts "S3a").
 */
export interface DiscrepancyLineCitation {
  /** Ordinal within the document; null when the parser recorded none. */
  lineNumber: number | null
  /** 1-based source row for CSV/XLSX; null for PDF. */
  sourceRow: number | null
  /** XLSX sheet name only; null for CSV and PDF. */
  sourceSheet: string | null
  /** 0..1 model confidence, PDF only (pg `numeric` is converted to number in the service). */
  extractionConfidence: number | null
  /** purchase_orders.id / invoices.id / goods_receipts.id of the owning document. */
  documentId: string
  /** Line provenance: 'csv' | 'xlsx' | 'pdf-extraction' | 'image-extraction' | 'manual'. */
  sourceKind?: string | null
  /** Set when a reviewer corrected this line before it was compared (photo intake). */
  editedAt?: string | null
}

/**
 * Additive fields on each item of `GET /workspaces/:id/procurement/discrepancies`.
 * `null` when the flag has no such line (header-level `currency_mismatch`,
 * `missing_on_*` for the absent side, or the line was deleted: ON DELETE SET NULL).
 * `receiptLine.extractionConfidence` is null unless the receipt was read from a photo.
 */
export interface DiscrepancyFlagCitations {
  poLine: DiscrepancyLineCitation | null
  invoiceLine: DiscrepancyLineCitation | null
  receiptLine: DiscrepancyLineCitation | null
}

/** Document kind as the vision model read it, or null for non-photo documents. */
export type DetectedProcurementKind = 'purchase_order' | 'invoice' | 'goods_receipt' | 'unknown'

/**
 * Header of `GET /workspaces/:id/procurement/{kind}/:docId/lines` (photo intake review).
 * A document with `reviewRequired && reviewedAt === null` is never compared.
 */
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

/** One line of a document under review. Decimals are strings, as stored. */
export interface ProcurementReviewLine {
  id: string
  lineNumber: number | null
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  uom: string | null
  /** Goods receipts only. */
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

/**
 * One line of `POST …/{kind}/:docId/review` (full replacement, 1..200 lines).
 * With `id`: an existing line of this document (kept or edited). Without: a new line.
 * Existing lines left out of the body are deleted.
 */
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
