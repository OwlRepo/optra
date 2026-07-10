import { ProcurementExtractionService } from './procurement-extraction.service'

const mockExtractLineItemsFromPdf = jest.fn()

jest.mock('@repo/ai', () => ({
  extractLineItemsFromPdf: (...args: unknown[]) => mockExtractLineItemsFromPdf(...args),
}))

describe('ProcurementExtractionService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates to @repo/ai extractLineItemsFromPdf with the given path', async () => {
    const result = { items: [{ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.9 }] }
    mockExtractLineItemsFromPdf.mockResolvedValue(result)

    const service = new ProcurementExtractionService()
    const actual = await service.extract('/tmp/x.pdf')

    expect(mockExtractLineItemsFromPdf).toHaveBeenCalledWith('/tmp/x.pdf')
    expect(actual).toBe(result)
  })

  it('propagates errors thrown by the underlying extraction chain', async () => {
    mockExtractLineItemsFromPdf.mockRejectedValue(new Error('boom'))

    const service = new ProcurementExtractionService()

    await expect(service.extract('/tmp/x.pdf')).rejects.toThrow('boom')
  })
})
