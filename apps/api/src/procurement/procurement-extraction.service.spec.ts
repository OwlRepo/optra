import { ProcurementExtractionService } from './procurement-extraction.service'
import { UsageService } from '../limits/usage.service'

const mockExtractLineItemsFromPdf = jest.fn()
const mockExtractLineItemsFromImages = jest.fn()

jest.mock('@repo/ai', () => ({
  extractLineItemsFromPdf: (...args: unknown[]) => mockExtractLineItemsFromPdf(...args),
  extractLineItemsFromImages: (...args: unknown[]) => mockExtractLineItemsFromImages(...args),
}))

describe('ProcurementExtractionService', () => {
  const meter = { record: jest.fn(), total: 0 }
  let usage: { metered: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    usage = { metered: jest.fn((_workspaceId: string, run: (m: typeof meter) => Promise<unknown>) => run(meter)) }
  })

  it('runs the extraction chain metered against the document workspace', async () => {
    const result = { items: [{ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.9 }] }
    mockExtractLineItemsFromPdf.mockResolvedValue(result)

    const service = new ProcurementExtractionService(usage as unknown as UsageService)
    const actual = await service.extract('/tmp/x.pdf', 'ws-1')

    expect(usage.metered).toHaveBeenCalledWith('ws-1', expect.any(Function))
    expect(mockExtractLineItemsFromPdf).toHaveBeenCalledWith('/tmp/x.pdf', { meter })
    expect(actual).toBe(result)
  })

  it('propagates errors thrown by the underlying extraction chain', async () => {
    mockExtractLineItemsFromPdf.mockRejectedValue(new Error('boom'))

    const service = new ProcurementExtractionService(usage as unknown as UsageService)

    await expect(service.extract('/tmp/x.pdf', 'ws-1')).rejects.toThrow('boom')
  })

  describe('extractFromImages', () => {
    const pages = [{ buffer: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg' as const }]

    it('error: a budget-exhausted workspace is refused by the meter before any model call', async () => {
      const budget = new Error('Monthly token budget exceeded')
      usage.metered.mockRejectedValue(budget)
      const service = new ProcurementExtractionService(usage as unknown as UsageService)

      await expect(service.extractFromImages(pages, 'invoice', 'ws-1')).rejects.toBe(budget)

      expect(mockExtractLineItemsFromImages).not.toHaveBeenCalled()
    })

    it('error: errors thrown by the vision chain propagate', async () => {
      mockExtractLineItemsFromImages.mockRejectedValue(new Error('vision boom'))
      const service = new ProcurementExtractionService(usage as unknown as UsageService)

      await expect(service.extractFromImages(pages, 'invoice', 'ws-1')).rejects.toThrow('vision boom')
    })

    it('regression: the PDF path is still metered and does not touch the vision chain', async () => {
      mockExtractLineItemsFromPdf.mockResolvedValue({ items: [] })
      const service = new ProcurementExtractionService(usage as unknown as UsageService)

      await service.extract('/tmp/x.pdf', 'ws-1')

      expect(mockExtractLineItemsFromImages).not.toHaveBeenCalled()
    })

    it('happy: runs the vision chain metered against the workspace with the document kind', async () => {
      const result = { items: [{ sku: 'A1' }], detectedKind: 'goods_receipt' }
      mockExtractLineItemsFromImages.mockResolvedValue(result)
      const service = new ProcurementExtractionService(usage as unknown as UsageService)

      const actual = await service.extractFromImages(pages, 'goods_receipt', 'ws-9')

      expect(usage.metered).toHaveBeenCalledWith('ws-9', expect.any(Function))
      expect(mockExtractLineItemsFromImages).toHaveBeenCalledWith(pages, 'goods_receipt', { meter })
      expect(actual).toBe(result)
    })
  })
})
