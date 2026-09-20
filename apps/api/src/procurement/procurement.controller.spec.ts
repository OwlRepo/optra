import type { Response } from 'express'
import { ProcurementController } from './procurement.controller'
import { ComparisonService } from './comparison.service'
import { ProcurementDocumentsService } from './procurement-documents.service'

function fakeRes() {
  return { set: jest.fn(), send: jest.fn() } as unknown as Response & { set: jest.Mock; send: jest.Mock }
}

// The procurement controller had no spec before S4. These pin the download
// header contract, which is the part a browser acts on: anything that made
// these bytes render inline, or let a filename escape the quoted header,
// would be a real vulnerability rather than a cosmetic regression.
describe('ProcurementController source downloads', () => {
  let documents: { getDownloadable: jest.Mock }
  let controller: ProcurementController

  beforeEach(() => {
    documents = { getDownloadable: jest.fn() }
    controller = new ProcurementController(
      documents as unknown as ProcurementDocumentsService,
      {} as unknown as ComparisonService,
    )
  })

  it('sends a purchase order as a named attachment, never inline', async () => {
    documents.getDownloadable.mockResolvedValue({ name: 'march-po.csv', buffer: Buffer.from('sku,qty\nA1,2\n') })
    const res = fakeRes()

    await controller.downloadPurchaseOrder('ws-1', 'doc-1', res)

    expect(documents.getDownloadable).toHaveBeenCalledWith('ws-1', 'purchase_order', 'doc-1')
    const headers = res.set.mock.calls[0][0] as Record<string, string>
    expect(headers['Content-Disposition']).toBe('attachment; filename="march-po.csv"')
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Length']).toBe('13')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.send).toHaveBeenCalledWith(Buffer.from('sku,qty\nA1,2\n'))
  })

  it('routes an invoice download to the invoice kind', async () => {
    documents.getDownloadable.mockResolvedValue({ name: 'march-inv.xlsx', buffer: Buffer.from('x') })
    const res = fakeRes()

    await controller.downloadInvoice('ws-1', 'doc-2', res)

    expect(documents.getDownloadable).toHaveBeenCalledWith('ws-1', 'invoice', 'doc-2')
  })

  // An uploaded filename is never validated, so a quote would close the quoted
  // header value early and a CRLF would start a new header.
  it('sanitizes a filename that would break out of the header', async () => {
    documents.getDownloadable.mockResolvedValue({
      name: 'evil"\r\nSet-Cookie: a=1.csv',
      buffer: Buffer.from('x'),
    })
    const res = fakeRes()

    await controller.downloadPurchaseOrder('ws-1', 'doc-3', res)

    const headers = res.set.mock.calls[0][0] as Record<string, string>
    expect(headers['Content-Disposition']).toBe('attachment; filename="evil___Set-Cookie: a=1.csv"')
    expect(headers['Content-Disposition']).not.toContain('\r')
    expect(headers['Content-Disposition']).not.toContain('\n')
  })

  it('does not send a body when the service refuses', async () => {
    documents.getDownloadable.mockRejectedValue(new Error('Purchase order not found'))
    const res = fakeRes()

    await expect(controller.downloadPurchaseOrder('ws-1', 'doc-4', res)).rejects.toThrow('Purchase order not found')

    expect(res.set).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })
})
