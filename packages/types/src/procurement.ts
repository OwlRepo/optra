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
}

/**
 * Additive fields on each item of `GET /workspaces/:id/procurement/discrepancies`.
 * `null` when the flag has no such line (header-level `currency_mismatch`,
 * `missing_on_*` for the absent side, or the line was deleted: ON DELETE SET NULL).
 * `receiptLine.extractionConfidence` is always null (goods_receipt_line_items has no such column).
 */
export interface DiscrepancyFlagCitations {
  poLine: DiscrepancyLineCitation | null
  invoiceLine: DiscrepancyLineCitation | null
  receiptLine: DiscrepancyLineCitation | null
}
