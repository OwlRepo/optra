import { BadRequestException, RequestMethod } from '@nestjs/common'
import type { Response } from 'express'
import { ProcurementController, photoFileFilter } from './procurement.controller'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { WorkspaceMemberGuard } from '../auth/guards/workspace-member.guard'
import { ComparisonService } from './comparison.service'
import { ProcurementDocumentsService } from './procurement-documents.service'
import { ProcurementReviewService } from './procurement-review.service'

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
      {} as unknown as ProcurementReviewService,
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

// Photo intake routes. Constructor: (documents, comparison, review).
describe('ProcurementController photo intake', () => {
  let documents: { uploadPhotos: jest.Mock }
  let review: { listLines: jest.Mock; getPage: jest.Mock; review: jest.Mock }
  let controller: ProcurementController
  const user = { userId: 'user-1' } as never

  beforeEach(() => {
    documents = { uploadPhotos: jest.fn() }
    review = { listLines: jest.fn(), getPage: jest.fn(), review: jest.fn() }
    controller = new ProcurementController(
      documents as unknown as ProcurementDocumentsService,
      {} as unknown as ComparisonService,
      review as unknown as ProcurementReviewService,
    )
  })

  const photoUploads = [
    ['purchase_order', 'uploadPurchaseOrderPhotos'],
    ['invoice', 'uploadInvoicePhotos'],
    ['goods_receipt', 'uploadGoodsReceiptPhotos'],
  ] as const

  describe.each(photoUploads)('%s photos', (kind, method) => {
    it('error: no files is a 400 "files are required" and nothing is uploaded', () => {
      const call = () => (controller as any)[method]('ws-1', { some: 'header' }, [])

      expect(call).toThrow(BadRequestException)
      expect(call).toThrow('files are required')
      expect(documents.uploadPhotos).not.toHaveBeenCalled()
    })

    it('error: an absent files field (undefined) is a 400 too', () => {
      expect(() => (controller as any)[method]('ws-1', {}, undefined)).toThrow('files are required')
    })

    it('happy: forwards the workspace, kind, files and header to uploadPhotos', async () => {
      const files = [{ originalname: 'a.jpg' }, { originalname: 'b.jpg' }] as Express.Multer.File[]
      documents.uploadPhotos.mockResolvedValue({ id: 'doc-1', name: 'a.pdf', status: 'pending' })
      const header = { grnNumber: 'GRN-1' }

      const result = await (controller as any)[method]('ws-1', header, files)

      expect(documents.uploadPhotos).toHaveBeenCalledWith('ws-1', kind, files, header)
      expect(result).toEqual({ id: 'doc-1', name: 'a.pdf', status: 'pending' })
    })
  })

  const pageRoutes = [
    ['purchase_order', 'getPurchaseOrderPage'],
    ['invoice', 'getInvoicePage'],
    ['goods_receipt', 'getGoodsReceiptPage'],
  ] as const

  describe.each(pageRoutes)('%s page route', (kind, method) => {
    it('error: does not send a body or headers when the service answers 404', async () => {
      review.getPage.mockRejectedValue(new Error('Purchase order not found'))
      const res = fakeRes()

      await expect((controller as any)[method]('ws-1', 'doc-1', 1, res)).rejects.toThrow('Purchase order not found')

      expect(res.set).not.toHaveBeenCalled()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('happy: serves image/jpeg inline with nosniff, a sandboxing CSP and a private no-store cache', async () => {
      review.getPage.mockResolvedValue(Buffer.from('jpeg-bytes'))
      const res = fakeRes()

      await (controller as any)[method]('ws-1', 'doc-1', 2, res)

      expect(review.getPage).toHaveBeenCalledWith('ws-1', kind, 'doc-1', 2)
      const headers = res.set.mock.calls[0][0] as Record<string, string>
      expect(headers['Content-Type']).toBe('image/jpeg')
      expect(headers['Content-Disposition']).toBe('inline')
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['Content-Security-Policy']).toBe("sandbox; default-src 'none'")
      expect(headers['Cache-Control']).toBe('private, no-store')
      expect(headers['Content-Length']).toBe(String(Buffer.from('jpeg-bytes').length))
      expect(res.send).toHaveBeenCalledWith(Buffer.from('jpeg-bytes'))
    })
  })

  const lineRoutes = [
    ['purchase_order', 'listPurchaseOrderLines', 'reviewPurchaseOrder'],
    ['invoice', 'listInvoiceLines', 'reviewInvoice'],
    ['goods_receipt', 'listGoodsReceiptLines', 'reviewGoodsReceipt'],
  ] as const

  describe.each(lineRoutes)('%s lines and review', (kind, listMethod, reviewMethod) => {
    it('error: a failing review propagates (409/404 come from the service)', async () => {
      review.review.mockRejectedValue(new Error('already reviewed'))

      await expect((controller as any)[reviewMethod]('ws-1', 'doc-1', { lines: [{}] }, user)).rejects.toThrow('already reviewed')
    })

    it('happy: lines are listed through the review service with the query', async () => {
      review.listLines.mockResolvedValue({ items: [] })
      const query = { page: '2', pageSize: '10' }

      await (controller as any)[listMethod]('ws-1', 'doc-1', query)

      expect(review.listLines).toHaveBeenCalledWith('ws-1', kind, 'doc-1', query)
    })

    it('happy: review passes the caller id from the JWT, never from the body', async () => {
      review.review.mockResolvedValue({ id: 'doc-1', reviewedAt: '2026-10-06T00:00:00.000Z', rowCount: 1 })
      const body = { lines: [{ sku: 'A1' }] }

      const result = await (controller as any)[reviewMethod]('ws-1', 'doc-1', body, user)

      expect(review.review).toHaveBeenCalledWith('ws-1', kind, 'doc-1', 'user-1', body)
      expect(result).toMatchObject({ id: 'doc-1', rowCount: 1 })
    })
  })
})

// Photos spend gpt-4o vision tokens, so they sit behind the same flag as PDFs.
describe('photoFileFilter', () => {
  const original = process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED
  const jpeg = { originalname: 'a.jpg', mimetype: 'image/jpeg' } as Express.Multer.File

  afterEach(() => {
    if (original === undefined) delete process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED
    else process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = original
  })

  it('error: with the vision flag off a valid photo is a 400 "Photo uploads are not enabled for this workspace"', () => {
    process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'false'
    const callback = jest.fn()

    photoFileFilter(null, jpeg, callback)

    const [error, accepted] = callback.mock.calls[0]
    expect(error).toBeInstanceOf(BadRequestException)
    expect((error as Error).message).toBe('Photo uploads are not enabled for this workspace')
    expect(accepted).toBe(false)
  })

  it('error: with the flag unset photos are refused too', () => {
    delete process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED
    const callback = jest.fn()

    photoFileFilter(null, jpeg, callback)

    expect((callback.mock.calls[0][0] as Error).message).toBe('Photo uploads are not enabled for this workspace')
  })

  it('happy: with the flag on a JPEG is accepted', () => {
    process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'true'
    const callback = jest.fn()

    photoFileFilter(null, jpeg, callback)

    expect(callback).toHaveBeenCalledWith(null, true)
  })
})

// Evidence-trail export. The controller only wires guards, headers and the
// workbook; the scope lives in ComparisonService.exportFlags.
describe('ProcurementController evidence-trail export', () => {
  let comparison: { exportFlags: jest.Mock }
  let controller: ProcurementController

  beforeEach(() => {
    comparison = { exportFlags: jest.fn().mockResolvedValue({ flags: [], decisions: [] }) }
    controller = new ProcurementController(
      {} as unknown as ProcurementDocumentsService,
      comparison as unknown as ComparisonService,
      {} as unknown as ProcurementReviewService,
    )
  })

  it('error: a service refusal sends no headers and no body', async () => {
    comparison.exportFlags.mockRejectedValue(new Error('Too many flags to export at once; narrow the filters'))
    const res = fakeRes()

    await expect(controller.exportDiscrepancies('ws-1', {}, res)).rejects.toThrow('narrow the filters')

    expect(res.set).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('error: the route is readable by any member, so it carries the member guards and no RolesGuard', () => {
    const guards = Reflect.getMetadata('__guards__', ProcurementController.prototype.exportDiscrepancies) as unknown[]

    expect(guards).toEqual([JwtAuthGuard, WorkspaceMemberGuard])
  })

  it('edge: the route is GET discrepancies/export', () => {
    const handler = ProcurementController.prototype.exportDiscrepancies

    expect(Reflect.getMetadata('path', handler)).toBe('discrepancies/export')
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET)
  })

  it('edge: the workspace id and the unpaginated filters go to the service unchanged', async () => {
    const query = { purchaseOrderId: 'po-1', invoiceId: 'inv-1', status: 'open' as const, runId: 'run-1' }

    await controller.exportDiscrepancies('ws-1', query, fakeRes())

    expect(comparison.exportFlags).toHaveBeenCalledWith('ws-1', query)
  })

  it('happy: sends the workbook as a private, non-sniffable xlsx attachment named by UTC date', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-08T23:30:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] })
    const res = fakeRes()

    try {
      await controller.exportDiscrepancies('ws-1', {}, res)
    } finally {
      jest.useRealTimers()
    }

    const headers = res.set.mock.calls[0][0] as Record<string, string>
    expect(headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(headers['Content-Disposition']).toBe('attachment; filename="optra-evidence-trail-2026-10-08.xlsx"')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Cache-Control']).toBe('private, no-store')
    const body = res.send.mock.calls[0][0] as Buffer
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(headers['Content-Length']).toBe(String(body.length))
  })
})
