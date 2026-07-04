import { PassThrough } from 'stream'
import type { Response } from 'express'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'

type MockResponse = Response & PassThrough & { set: jest.Mock; send: jest.Mock }

function fakeRes(): MockResponse {
  const stream = new PassThrough() as PassThrough & { set: jest.Mock; send: jest.Mock }
  stream.set = jest.fn().mockReturnThis()
  stream.send = jest.fn()
  return stream as unknown as MockResponse
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('DocumentsController downloads', () => {
  let service: { getDownloadable: jest.Mock; getManyDownloadable: jest.Mock; removeMany: jest.Mock }
  let controller: DocumentsController

  beforeEach(() => {
    service = {
      getDownloadable: jest.fn(),
      getManyDownloadable: jest.fn(),
      removeMany: jest.fn(),
    }
    controller = new DocumentsController(service as unknown as DocumentsService)
  })

  it('single download sets attachment headers and sends the buffer', async () => {
    service.getDownloadable.mockResolvedValue({ title: 'report.txt', buffer: Buffer.from('hello') })
    const res = fakeRes()

    await controller.download('ws', 'kb', 'doc', res)

    expect(service.getDownloadable).toHaveBeenCalledWith('ws', 'kb', 'doc')
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="report.txt"',
      }),
    )
    expect(res.send).toHaveBeenCalledWith(Buffer.from('hello'))
  })

  it('sanitizes quotes and newlines in the download filename', async () => {
    service.getDownloadable.mockResolvedValue({ title: 'a"b\nc.txt', buffer: Buffer.from('x') })
    const res = fakeRes()

    await controller.download('ws', 'kb', 'doc', res)

    const headers = res.set.mock.calls[0][0] as Record<string, string>
    expect(headers['Content-Disposition']).toBe('attachment; filename="a_b_c.txt"')
  })

  it('bulk download streams a zip archive of the selected documents', async () => {
    service.getManyDownloadable.mockResolvedValue([
      { title: 'a.txt', buffer: Buffer.from('aaa') },
      { title: 'a.txt', buffer: Buffer.from('bbb') },
    ])
    const res = fakeRes()
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))

    await controller.downloadMany('ws', 'kb', { documentIds: ['a', 'b'] }, res)
    await flush()

    expect(service.getManyDownloadable).toHaveBeenCalledWith('ws', 'kb', ['a', 'b'])
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'application/zip' }),
    )
    const out = Buffer.concat(chunks)
    expect(out.length).toBeGreaterThan(0)
    expect(out.subarray(0, 2).toString()).toBe('PK')
  })

  it('bulk delete returns selected document deletion counts', async () => {
    service.removeMany.mockResolvedValue({ deleted: 2, skipped: 1 })

    await expect(
      controller.deleteMany('ws', 'kb', { documentIds: ['a', 'b', 'c'] }),
    ).resolves.toEqual({ deleted: 2, skipped: 1 })
    expect(service.removeMany).toHaveBeenCalledWith('ws', 'kb', ['a', 'b', 'c'])
  })
})
