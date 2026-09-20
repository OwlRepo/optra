import { CatalogExtractionService } from './catalog-extraction.service'
import { UsageService } from '../limits/usage.service'

const mockExtractCatalogItemsFromImage = jest.fn()
const mockCompareLineItemToCatalogImage = jest.fn()

jest.mock('@repo/ai', () => ({
  extractCatalogItemsFromImage: (...args: unknown[]) => mockExtractCatalogItemsFromImage(...args),
  compareLineItemToCatalogImage: (...args: unknown[]) => mockCompareLineItemToCatalogImage(...args),
}))

describe('CatalogExtractionService', () => {
  const meter = { record: jest.fn(), total: 0 }
  let usage: { metered: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    usage = { metered: jest.fn((_workspaceId: string, run: (m: typeof meter) => Promise<unknown>) => run(meter)) }
  })

  it('runs page extraction metered against the catalog workspace', async () => {
    const result = { items: [{ sku: 'A1', description: 'Widget', confidence: 0.9 }] }
    mockExtractCatalogItemsFromImage.mockResolvedValue(result)
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    const service = new CatalogExtractionService(usage as unknown as UsageService)
    const actual = await service.extractFromImage(buffer, 'ws-1')

    expect(usage.metered).toHaveBeenCalledWith('ws-1', expect.any(Function))
    expect(mockExtractCatalogItemsFromImage).toHaveBeenCalledWith(buffer, { meter })
    expect(actual).toBe(result)
  })

  it('propagates errors thrown by the underlying extraction chain', async () => {
    mockExtractCatalogItemsFromImage.mockRejectedValue(new Error('boom'))

    const service = new CatalogExtractionService(usage as unknown as UsageService)

    await expect(service.extractFromImage(Buffer.from([0x89]), 'ws-1')).rejects.toThrow('boom')
  })

  it('runs the match comparator metered against the workspace', async () => {
    const result = { isMatch: true, score: 0.9, reason: 'Same product.' }
    mockCompareLineItemToCatalogImage.mockResolvedValue(result)
    const input = { queryText: 'q', candidateText: 'c', candidateImageBase64: null }

    const service = new CatalogExtractionService(usage as unknown as UsageService)
    const actual = await service.compare(input, 'ws-1')

    expect(usage.metered).toHaveBeenCalledWith('ws-1', expect.any(Function))
    expect(mockCompareLineItemToCatalogImage).toHaveBeenCalledWith({ ...input, meter })
    expect(actual).toBe(result)
  })
})
