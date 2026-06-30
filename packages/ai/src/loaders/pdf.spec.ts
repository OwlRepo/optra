import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()
const stat = vi.fn()
const getText = vi.fn()
const destroy = vi.fn()

vi.mock('fs/promises', () => ({
  readFile,
  stat,
}))

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText,
    destroy,
  })),
}))

describe('loadPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(getText).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
