import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

describe('extractCatalogItemsFromImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed catalog items on happy path', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({
        items: [
          { sku: 'A1', description: 'Widget', confidence: 0.92 },
          { sku: 'B2', description: 'Gadget', confidence: 0.88 },
        ],
      }),
    })

    const { extractCatalogItemsFromImage } = await import('./catalog-match')
    const result = await extractCatalogItemsFromImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    expect(result).toEqual({
      items: [
        { sku: 'A1', description: 'Widget', confidence: 0.92 },
        { sku: 'B2', description: 'Gadget', confidence: 0.88 },
      ],
    })
  })

  it('returns an empty items array for a page with no products, not an error', async () => {
    invokeMock.mockResolvedValue({ content: JSON.stringify({ items: [] }) })

    const { extractCatalogItemsFromImage } = await import('./catalog-match')
    const result = await extractCatalogItemsFromImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    expect(result).toEqual({ items: [] })
  })

  it('throws CatalogExtractionParseError on malformed JSON', async () => {
    invokeMock.mockResolvedValue({ content: 'not json' })

    const { extractCatalogItemsFromImage, CatalogExtractionParseError } = await import('./catalog-match')

    await expect(extractCatalogItemsFromImage(Buffer.from([0x89]))).rejects.toThrow(CatalogExtractionParseError)
  })

  it('throws CatalogExtractionRefusalError when the model refuses', async () => {
    invokeMock.mockResolvedValue({ content: "I can't help with that request." })

    const { extractCatalogItemsFromImage, CatalogExtractionRefusalError } = await import('./catalog-match')

    await expect(extractCatalogItemsFromImage(Buffer.from([0x89]))).rejects.toThrow(CatalogExtractionRefusalError)
  })

  it('retries once on a timeout error then succeeds', async () => {
    const timeoutError = new Error('Request timed out')
    timeoutError.name = 'TimeoutError'
    invokeMock.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({
      content: JSON.stringify({ items: [{ sku: 'A1', description: 'Widget', confidence: 0.9 }] }),
    })

    const { extractCatalogItemsFromImage } = await import('./catalog-match')
    const result = await extractCatalogItemsFromImage(Buffer.from([0x89]), { retryDelayMs: 1 })

    expect(result.items).toHaveLength(1)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
})

describe('compareLineItemToCatalogImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a match verdict with an image block when a candidate image is provided', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({ isMatch: true, score: 0.95, reason: 'Same widget, matching label.' }),
    })

    const { compareLineItemToCatalogImage } = await import('./catalog-match')
    const result = await compareLineItemToCatalogImage({
      queryText: 'SKU A1: Widget',
      candidateText: 'SKU A1: Widget',
      candidateImageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
    })

    expect(result).toEqual({ isMatch: true, score: 0.95, reason: 'Same widget, matching label.' })

    const humanMessage = invokeMock.mock.calls[0][0][1]
    expect(humanMessage.content).toHaveLength(2)
    expect(humanMessage.content[1].type).toBe('image_url')
  })

  it('omits the image block and still judges text-only when the candidate has no image', async () => {
    invokeMock.mockResolvedValue({
      content: JSON.stringify({ isMatch: false, score: 0.2, reason: 'No image available; descriptions differ.' }),
    })

    const { compareLineItemToCatalogImage } = await import('./catalog-match')
    const result = await compareLineItemToCatalogImage({
      queryText: 'SKU A1: Widget',
      candidateText: 'SKU B2: Gadget',
      candidateImageBase64: null,
    })

    expect(result.isMatch).toBe(false)

    const humanMessage = invokeMock.mock.calls[0][0][1]
    expect(humanMessage.content).toHaveLength(1)
  })

  it('throws CatalogExtractionParseError when isMatch is missing', async () => {
    invokeMock.mockResolvedValue({ content: JSON.stringify({ score: 0.5, reason: 'unsure' }) })

    const { compareLineItemToCatalogImage, CatalogExtractionParseError } = await import('./catalog-match')

    await expect(
      compareLineItemToCatalogImage({ queryText: 'q', candidateText: 'c', candidateImageBase64: null }),
    ).rejects.toThrow(CatalogExtractionParseError)
  })

  it('throws CatalogExtractionRefusalError when the model refuses', async () => {
    invokeMock.mockResolvedValue({ content: "I can't help with that request." })

    const { compareLineItemToCatalogImage, CatalogExtractionRefusalError } = await import('./catalog-match')

    await expect(
      compareLineItemToCatalogImage({ queryText: 'q', candidateText: 'c', candidateImageBase64: null }),
    ).rejects.toThrow(CatalogExtractionRefusalError)
  })
})
