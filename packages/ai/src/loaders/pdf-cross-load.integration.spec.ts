import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadPDF } from './pdf'
import { renderPdfToImages } from './pdf-render'

// Regression (2026-10-02): text extraction and page rendering ran on two
// different copies of pdfjs in one process. Both register their in-process
// "fake worker" on the single global `globalThis.pdfjsWorker`, so whichever
// ran first won and the other failed until the server restarted:
//   render, then extract -> `The API version "5.4.296" does not match the Worker version "6.1.200"`
//   extract, then render -> `Could not read this PDF`
// Real libraries, no mocks, one process: the order of these cases matters.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

async function pdfWith(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage()
  page.drawText(text, { x: 50, y: page.getHeight() - 50, size: 14, font })
  return Buffer.from(await doc.save())
}

function expectPng(buffer: Buffer): void {
  expect(buffer.length).toBeGreaterThan(0)
  expect([...buffer.subarray(0, 4)]).toEqual(PNG_MAGIC)
}

describe('PDF text extraction and page rendering share one process', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdf-cross-load-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function pdfFile(name: string, text: string): Promise<string> {
    const path = join(dir, name)
    await writeFile(path, await pdfWith(text))
    return path
  }

  it('edge: extracts and renders concurrently without either failing', async () => {
    const files = await Promise.all([1, 2, 3].map((n) => pdfFile(`po-${n}.pdf`, `PO line marker ${n}`)))
    const renders = await Promise.all([1, 2, 3].map((n) => pdfWith(`Catalog page ${n}`)))

    const results = await Promise.all([
      ...files.map((file) => loadPDF(file)),
      ...renders.map((bytes) => renderPdfToImages(bytes)),
    ])

    for (const [i, result] of results.slice(0, 3).entries()) {
      expect((result as { content: string }).content).toContain(`PO line marker ${i + 1}`)
    }
    for (const result of results.slice(3)) {
      expectPng((result as { pages: Buffer[] }).pages[0])
    }
  })

  it('regression: extracts a PO after a catalog page was rendered', async () => {
    const rendered = await renderPdfToImages(await pdfWith('Catalog page: NW-2010 desk lamp'))
    expectPng(rendered.pages[0])

    const po = await loadPDF(await pdfFile('po-after-render.pdf', 'PO-4471 line 3 NW-2010'))

    expect(po.content).toContain('PO-4471 line 3 NW-2010')
    expect(po.metadata.pageCount).toBe(1)
  })

  it('regression: renders a catalog page after a PO was extracted', async () => {
    const po = await loadPDF(await pdfFile('po-before-render.pdf', 'INV-88213 line 7'))
    expect(po.content).toContain('INV-88213 line 7')

    const rendered = await renderPdfToImages(await pdfWith('Catalog page: NW-1005 folders'))

    expect(rendered.total).toBe(1)
    expectPng(rendered.pages[0])
  })
})
