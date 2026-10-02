import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()
const stat = vi.fn()
const destroy = vi.fn()
const pdfjs = vi.hoisted(() => ({ loadCount: 0, getDocument: vi.fn() }))

vi.mock('fs/promises', () => ({
  readFile,
  stat,
}))

// loadPDF reads through the one shared pdfjs copy (./pdfjs), never pdf-parse:
// two pdfjs copies in one process fight over `globalThis.pdfjsWorker`.
vi.mock('./pdfjs', () => ({
  loadPdfjs: vi.fn(async () => {
    pdfjs.loadCount += 1
    return { getDocument: pdfjs.getDocument }
  }),
}))

function textPage(items: Array<{ str: string; hasEOL?: boolean }>) {
  return { getTextContent: vi.fn().mockResolvedValue({ items }), cleanup: vi.fn() }
}

describe('loadPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    pdfjs.loadCount = 0
  })

  it('error: still destroys the loading task when a page fails to read', async () => {
    readFile.mockResolvedValue(Buffer.from('pdf-bytes'))
    stat.mockResolvedValue({ size: 10 })
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockRejectedValue(new Error('bad page')),
      }),
      destroy,
    })

    const { loadPDF } = await import('./pdf')

    await expect(loadPDF('/tmp/bad.pdf')).rejects.toThrow('bad page')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('edge: does not load pdfjs at module import time', async () => {
    await import('./pdf')

    expect(pdfjs.loadCount).toBe(0)
  })

  it('regression: never imports pdf-parse (a second pdfjs copy)', () => {
    const source = readFileSync(join(__dirname, 'pdf.ts'), 'utf8')

    expect(source).not.toMatch(/['"]pdf-parse['"]/)
  })

  it('happy: joins page text through the shared pdfjs copy', async () => {
    readFile.mockResolvedValue(Buffer.from('pdf-bytes'))
    stat.mockResolvedValue({ size: 1234 })
    const pages = [
      textPage([{ str: 'hello', hasEOL: false }, { str: ' ', hasEOL: false }, { str: 'pdf', hasEOL: true }, { str: 'line two' }]),
      textPage([{ str: 'page two' }]),
    ]
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn((n: number) => Promise.resolve(pages[n - 1])),
      }),
      destroy,
    })

    const { loadPDF } = await import('./pdf')

    await expect(loadPDF('/tmp/demo.pdf')).resolves.toEqual({
      content: 'hello pdf\nline two\n\npage two',
      metadata: {
        source: '/tmp/demo.pdf',
        fileType: 'pdf',
        fileName: 'demo.pdf',
        fileSize: 1234,
        pageCount: 2,
      },
    })
    expect(pdfjs.loadCount).toBe(1)
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: new Uint8Array(Buffer.from('pdf-bytes')) })
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
