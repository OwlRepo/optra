// Global env flag (not per workspace — there is no per-workspace flag store).
// Read at call time, not import time, so the upload filter and the parse
// worker agree even when the flag changes between upload and processing.
export function pdfExtractionEnabled(): boolean {
  return process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED === 'true'
}
