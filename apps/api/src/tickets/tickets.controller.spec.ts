import { PassThrough } from 'stream'
import type { Response } from 'express'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'

type MockResponse = Response & PassThrough & { set: jest.Mock; send: jest.Mock }

function fakeRes(): MockResponse {
  const stream = new PassThrough() as PassThrough & { set: jest.Mock; send: jest.Mock }
  stream.set = jest.fn().mockReturnThis()
  stream.send = jest.fn()
  return stream as unknown as MockResponse
}

describe('TicketsController transcript download', () => {
  let service: { getTranscriptPdf: jest.Mock }
  let controller: TicketsController

  beforeEach(() => {
    service = { getTranscriptPdf: jest.fn() }
    controller = new TicketsController(service as unknown as TicketsService)
  })

  it('sets PDF attachment headers and sends the buffer', async () => {
    service.getTranscriptPdf.mockResolvedValue({ title: 'ticket.pdf', buffer: Buffer.from('%PDF-1.4') })
    const res = fakeRes()

    await controller.downloadTranscript('ws', 'ticket-1', res)

    expect(service.getTranscriptPdf).toHaveBeenCalledWith('ws', 'ticket-1')
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ticket.pdf"',
      }),
    )
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'))
  })

  it('sanitizes quotes and newlines in the filename', async () => {
    service.getTranscriptPdf.mockResolvedValue({ title: 'a"b\nc.pdf', buffer: Buffer.from('x') })
    const res = fakeRes()

    await controller.downloadTranscript('ws', 'ticket-1', res)

    const headers = res.set.mock.calls[0][0] as Record<string, string>
    expect(headers['Content-Disposition']).toBe('attachment; filename="a_b_c.pdf"')
  })
})
