import type { ArgumentsHost } from '@nestjs/common'
import { BadRequestException } from '@nestjs/common'
import type { Response } from 'express'
import { MulterError } from 'multer'
import { ProcurementController, UploadExceptionFilter } from './procurement.controller'
import { ComparisonService } from './comparison.service'
import { ProcurementDocumentsService } from './procurement-documents.service'

function fakeRes() {
  return { set: jest.fn(), send: jest.fn() } as unknown as Response & { set: jest.Mock; send: jest.Mock }
}

function fakeHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost
  return { host, res }
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

// The filter is scoped to the two upload handlers, so it sees every
// BadRequestException they raise. Before S3b those were only fileFilter's
// plain-string rejections, and flattening them to a single message was right.
// Now the same routes also raise class-validator errors carrying a message
// ARRAY, and flattening those would throw away the per-field detail the upload
// form needs. The first two tests pin the behaviour that must NOT change.
describe('UploadExceptionFilter', () => {
  let filter: UploadExceptionFilter

  beforeEach(() => {
    filter = new UploadExceptionFilter()
  })

  it('still answers 413 for a file over the size limit', () => {
    const { host, res } = fakeHost()

    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({ statusCode: 413, message: expect.stringContaining('upload limit') })
  })

  it('still flattens a plain-string rejection from fileFilter', () => {
    const { host, res } = fakeHost()

    filter.catch(new BadRequestException('Only CSV, XLSX, or PDF files are supported'), host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Only CSV, XLSX, or PDF files are supported',
    })
  })

  it('preserves the per-field message array from a validation failure', () => {
    const { host, res } = fakeHost()
    // The shape ValidationPipe actually throws.
    const validationError = new BadRequestException({
      statusCode: 400,
      message: ['vendorId must be a UUID', 'currency must be a 3-letter ISO 4217 code'],
      error: 'Bad Request',
    })

    filter.catch(validationError, host)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['vendorId must be a UUID', 'currency must be a 3-letter ISO 4217 code'],
      error: 'Bad Request',
    })
  })
})
