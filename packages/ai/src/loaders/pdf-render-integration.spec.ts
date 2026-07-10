import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { renderPdfToImages } from './pdf-render'

// Mirrors pdf-integration.spec.ts's pattern: pdf-render.spec.ts fully mocks
// pdfjs-dist/@napi-rs/canvas, so this exercises the real rasterizer against
// a real, freshly generated PDF — proving the actual library combination
// works (no hang, real PNG bytes out), not just that the code calls the
// right method names.
describe('renderPdfToImages (real pdfjs-dist + @napi-rs/canvas, no mocks)', () => {
  it('renders a real single-page PDF to a real PNG buffer', async () => {
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const page = pdfDoc.addPage()
    page.drawText('QA integration marker: RASTER-MARKER-42', {
      x: 50,
      y: page.getHeight() - 50,
      size: 14,
      font,
    })
    const bytes = await pdfDoc.save()

    const result = await renderPdfToImages(Buffer.from(bytes))

    expect(result.total).toBe(1)
    expect(result.pages).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(Buffer.isBuffer(result.pages[0])).toBe(true)
    expect(result.pages[0].length).toBeGreaterThan(0)
    // PNG magic bytes: 0x89 'P' 'N' 'G'
    expect(result.pages[0][0]).toBe(0x89)
    expect(result.pages[0][1]).toBe(0x50)
    expect(result.pages[0][2]).toBe(0x4e)
    expect(result.pages[0][3]).toBe(0x47)
  })

  it('caps a multi-page PDF at maxPages and reports the real total', async () => {
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 3; i += 1) {
      const page = pdfDoc.addPage()
      page.drawText(`page ${i + 1}`, { x: 50, y: page.getHeight() - 50, size: 14, font })
    }
    const bytes = await pdfDoc.save()

    const result = await renderPdfToImages(Buffer.from(bytes), { maxPages: 2 })

    expect(result.total).toBe(3)
    expect(result.pages).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})
