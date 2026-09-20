import { ProcurementExtractionService } from './procurement-extraction.service'
import { UsageService } from '../limits/usage.service'

const mockExtractLineItemsFromPdf = jest.fn()

jest.mock('@repo/ai', () => ({
  extractLineItemsFromPdf: (...args: unknown[]) => mockExtractLineItemsFromPdf(...args),
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
})
