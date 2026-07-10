import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocumentMock = vi.fn()

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

vi.mock('@napi-rs/canvas', () => ({
  createCanvas: () => ({
    getContext: () => ({}),
    toBuffer: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
  }),
}))

function fakeDoc(pageCount: number) {
  return {
    numPages: pageCount,
    getPage: async (_index: number) => ({
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  }
}

describe('renderPdfToImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every page as a PNG buffer when under the page cap', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc(3)) })

    const { renderPdfToImages } = await import('./pdf-render')
    const result = await renderPdfToImages(Buffer.from('fake pdf bytes'))

    expect(result.pages).toHaveLength(3)
    expect(result.total).toBe(3)
    expect(result.truncated).toBe(false)
    expect(Buffer.isBuffer(result.pages[0])).toBe(true)
  })

  it('caps at maxPages and reports truncated with the real total', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc(15)) })

    const { renderPdfToImages } = await import('./pdf-render')
    const result = await renderPdfToImages(Buffer.from('fake pdf bytes'), { maxPages: 10 })

    expect(result.pages).toHaveLength(10)
    expect(result.total).toBe(15)
    expect(result.truncated).toBe(true)
  })

  it('throws when the document has zero pages', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc(0)) })

    const { renderPdfToImages } = await import('./pdf-render')

    await expect(renderPdfToImages(Buffer.from('fake pdf bytes'))).rejects.toThrow(/page/i)
  })

  it('propagates a clear error when the document cannot be opened', async () => {
    // mockImplementation (not mockReturnValue) so the rejected promise is
    // created lazily when renderPdfToImages actually calls getDocument(),
    // not eagerly at mock-setup time — avoids a transient unhandled-rejection
    // warning from a promise that briefly exists before anything awaits it.
    getDocumentMock.mockImplementation(() => ({ promise: Promise.reject(new Error('cannot open broken pdf')) }))

    const { renderPdfToImages } = await import('./pdf-render')

    await expect(renderPdfToImages(Buffer.from('not a pdf'))).rejects.toThrow('cannot open broken pdf')
  })

  it('converts a Node Buffer to a plain Uint8Array before calling getDocument', async () => {
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc(1)) })

    const { renderPdfToImages } = await import('./pdf-render')
    await renderPdfToImages(Buffer.from('fake pdf bytes'))

    const passedData = getDocumentMock.mock.calls[0][0].data
    expect(Buffer.isBuffer(passedData)).toBe(false)
    expect(passedData).toBeInstanceOf(Uint8Array)
  })
})
