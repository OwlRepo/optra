import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()
const stat = vi.fn()
const getText = vi.fn()
const destroy = vi.fn()
const pdfParse = vi.hoisted(() => ({
  importCount: 0,
  PDFParse: vi.fn().mockImplementation(() => ({
    getText,
    destroy,
  })),
}))

vi.mock('fs/promises', () => ({
  readFile,
  stat,
}))

vi.mock('pdf-parse', () => {
  pdfParse.importCount += 1
  return { PDFParse: pdfParse.PDFParse }
})

describe('loadPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    pdfParse.importCount = 0
  })

  it('does not load pdf-parse at module import time', async () => {
    await import('./pdf')

    expect(pdfParse.importCount).toBe(0)
  })

  it('parses content through the exported pdf-parse API', async () => {
    readFile.mockResolvedValue(Buffer.from('pdf-bytes'))
    stat.mockResolvedValue({ size: 1234 })
    getText.mockResolvedValue({
      text: 'hello pdf',
      total: 7,
    })
    destroy.mockResolvedValue(undefined)

    const { loadPDF } = await import('./pdf')

    await expect(loadPDF('/tmp/demo.pdf')).resolves.toEqual({
      content: 'hello pdf',
      metadata: {
        source: '/tmp/demo.pdf',
        fileType: 'pdf',
        fileName: 'demo.pdf',
        fileSize: 1234,
        pageCount: 7,
      },
    })

    expect(pdfParse.importCount).toBe(1)
    expect(pdfParse.PDFParse).toHaveBeenCalledWith({ data: Buffer.from('pdf-bytes') })
    expect(getText).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
