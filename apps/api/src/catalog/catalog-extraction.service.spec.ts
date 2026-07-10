import { CatalogExtractionService } from './catalog-extraction.service'

const mockExtractCatalogItemsFromImage = jest.fn()
const mockCompareLineItemToCatalogImage = jest.fn()

jest.mock('@repo/ai', () => ({
  extractCatalogItemsFromImage: (...args: unknown[]) => mockExtractCatalogItemsFromImage(...args),
  compareLineItemToCatalogImage: (...args: unknown[]) => mockCompareLineItemToCatalogImage(...args),
}))

describe('CatalogExtractionService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates to @repo/ai extractCatalogItemsFromImage with the given buffer', async () => {
    const result = { items: [{ sku: 'A1', description: 'Widget', confidence: 0.9 }] }
    mockExtractCatalogItemsFromImage.mockResolvedValue(result)
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    const service = new CatalogExtractionService()
    const actual = await service.extractFromImage(buffer)

    expect(mockExtractCatalogItemsFromImage).toHaveBeenCalledWith(buffer)
    expect(actual).toBe(result)
  })

  it('propagates errors thrown by the underlying extraction chain', async () => {
    mockExtractCatalogItemsFromImage.mockRejectedValue(new Error('boom'))

    const service = new CatalogExtractionService()

    await expect(service.extractFromImage(Buffer.from([0x89]))).rejects.toThrow('boom')
  })

  it('delegates to @repo/ai compareLineItemToCatalogImage with the given input', async () => {
    const result = { isMatch: true, score: 0.9, reason: 'Same product.' }
    mockCompareLineItemToCatalogImage.mockResolvedValue(result)
    const input = { queryText: 'q', candidateText: 'c', candidateImageBase64: null }

    const service = new CatalogExtractionService()
    const actual = await service.compare(input)

    expect(mockCompareLineItemToCatalogImage).toHaveBeenCalledWith(input)
    expect(actual).toBe(result)
  })
})
