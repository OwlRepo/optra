import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPDF } from './pdf'

// Regression: real PDFs failed to ingest with `ReferenceError: DOMMatrix is
// not defined` — pdf-parse's bundled pdfjs-dist constructs `new DOMMatrix()`
// at module top level, which crashes on this repo's Node/Alpine image (no
// DOMMatrix, and no `process.getBuiltinModule` to polyfill it from `canvas`).
// pdf.spec.ts mocks `pdf-parse` entirely, so it can't catch this — this file
// exercises the real dependency against a real, freshly generated PDF.
describe('loadPDF (real pdf-parse, no mocks)', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) await rm(dir, { recursive: true, force: true })
    }
  })

  it('extracts text from a real PDF without crashing on module load', async () => {
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const page = pdfDoc.addPage()
    page.drawText('QA integration marker: TEAL-GIRAFFE-17', {
      x: 50,
      y: page.getHeight() - 50,
      size: 14,
      font,
    })
    const bytes = await pdfDoc.save()

    const dir = await mkdtemp(join(tmpdir(), 'pdf-loader-spec-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.pdf')
    await writeFile(filePath, bytes)

    const result = await loadPDF(filePath)

    expect(result.content).toContain('TEAL-GIRAFFE-17')
    expect(result.metadata.fileType).toBe('pdf')
    expect(result.metadata.fileName).toBe('sample.pdf')
    expect(result.metadata.pageCount).toBe(1)
  })
})
