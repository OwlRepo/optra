// Global env flag (not per workspace — there is no per-workspace flag store).
// Read at call time, not import time, so the upload filter and the parse
// worker agree even when the flag changes between upload and processing.
export function pdfExtractionEnabled(): boolean {
  return process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED === 'true'
}

/**
 * S8 auto-orchestration, off unless explicitly enabled.
 *
 * Default-off is not timidity. A comparison run is permanent evidence, and
 * POLICY v1 #9's retention guard then refuses to hard-delete any document that
 * run referenced — so the first deploy of something that writes runs on its
 * own should not also be the first time anyone watches it behave.
 *
 * Read at call time, for the same reason as the flag above.
 */
export function autoCompareEnabled(): boolean {
  return process.env.PROCUREMENT_AUTO_COMPARE_ENABLED === 'true'
}
