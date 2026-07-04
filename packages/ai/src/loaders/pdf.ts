import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { LoadedDocument } from './types'

// pdf-parse's bundled pdfjs-dist constructs `new DOMMatrix()` at module top
// level (unconditionally, even for pure text extraction with no rendering).
// Node has no DOMMatrix/ImageData/Path2D; pdfjs-dist normally polyfills them
// from the optional `canvas` package via `process.getBuiltinModule`, which
// this image's Node runtime doesn't have, so the polyfill silently no-ops
// and the bare `new DOMMatrix()` throws ReferenceError, crashing every PDF
// ingest. Stub the three globals so the module loads; text extraction never
// exercises their real geometry, so no-op stubs are sufficient.
function ensurePdfjsNodePolyfills(): void {
  const target = globalThis as Record<string, unknown>
  if (typeof target.DOMMatrix === 'undefined') {
    target.DOMMatrix = class DOMMatrix {}
  }
  if (typeof target.ImageData === 'undefined') {
    target.ImageData = class ImageData {}
  }
  if (typeof target.Path2D === 'undefined') {
    target.Path2D = class Path2D {}
  }
}

export async function loadPDF(filePath: string): Promise<LoadedDocument> {
  const [buffer, stats] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ])

  ensurePdfjsNodePolyfills()
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  await parser.destroy()

  return {
    content: result.text,
    metadata: {
      source: filePath,
      fileType: 'pdf',
      fileName: basename(filePath),
      fileSize: stats.size,
      pageCount: result.total,
    },
  }
}
