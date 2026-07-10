import { createCanvas } from '@napi-rs/canvas'

// Renders PDF pages to PNG images for the vision-extraction path (scanned/
// image-only PDFs with no text layer). Uses pdfjs-dist (Apache-2.0) +
// @napi-rs/canvas (MIT, prebuilt binaries) instead of mupdf (AGPL-3.0) —
// same "screenshot each page" outcome, permissively licensed.
//
// pdfjs-dist's legacy build tries `new Worker(...)` (a browser API) first;
// that throws synchronously in Node (no global `Worker`), which it catches
// and falls back to an in-process "fake worker" automatically — verified in
// its own source (`PDFWorker.#initialize`), not assumed. No real worker
// thread, no file path to resolve, no hang risk from that mechanism.
export interface RenderPdfOptions {
  maxPages?: number
  scale?: number
}

export interface RenderPdfResult {
  pages: Buffer[]
  total: number
  truncated: boolean
}

const DEFAULT_MAX_PAGES = 10
const DEFAULT_SCALE = 2

export async function renderPdfToImages(data: Buffer, opts: RenderPdfOptions = {}): Promise<RenderPdfResult> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const scale = opts.scale ?? DEFAULT_SCALE

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  // pdfjs-dist explicitly rejects a Node Buffer instance (even though Buffer
  // extends Uint8Array) and requires a plain Uint8Array — verified via its
  // own thrown error, not guessed.
  //
  // Not passing standardFontDataUrl: pdfjs-dist warns when a PDF references
  // a non-embedded font and no font-substitution data is configured, but
  // still renders the page correctly (verified via a real smoke test) — a
  // cosmetic warning, not a functional gap. Wiring it up would need
  // `import.meta.resolve`, which this package's commonjs module target
  // (tsconfig.json) doesn't support; not worth changing shared build config
  // for a warning with no effect on output.
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise

  const total = doc.numPages
  if (total === 0) {
    throw new Error('PDF has zero pages')
  }

  const pageCount = Math.min(total, maxPages)
  const pages: Buffer[] = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')

    // @napi-rs/canvas's 2D context implements the same surface pdfjs-dist
    // expects from a browser CanvasRenderingContext2D — this cast is the
    // standard, documented way these two libraries are used together.
    // `canvas: null` is required by this pdfjs-dist version's RenderParameters
    // type when using the canvasContext-only (non-HTMLCanvasElement) path —
    // verified in its real type definition, not assumed.
    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
    pages.push(canvas.toBuffer('image/png'))
  }

  return { pages, total, truncated: total > maxPages }
}
