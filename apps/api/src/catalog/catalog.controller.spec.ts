import type { Response } from 'express'
import { CatalogController } from './catalog.controller'
import type { CatalogDocumentsService } from './catalog-documents.service'

// The photo route is the one place stored bytes are served INLINE, so its
// headers carry the whole defence: a raster Content-Type chosen by the service
// (never SVG), and nosniff so a browser cannot second-guess that type. Nothing
// else in the stack sets nosniff locally - Caddy does in production only.

function fakeRes(): Response & { set: jest.Mock; send: jest.Mock } {
  return { set: jest.fn().mockReturnThis(), send: jest.fn() } as unknown as Response & {
    set: jest.Mock
    send: jest.Mock
  }
}

describe('CatalogController photo', () => {
  it('serves the photo with its raster type, private caching and nosniff', async () => {
    const documents = {
      getItemPhoto: jest.fn().mockResolvedValue({ buffer: Buffer.from('png'), contentType: 'image/png' }),
    }
    const controller = new CatalogController(
      {} as never,
      documents as unknown as CatalogDocumentsService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    const res = fakeRes()

    await controller.catalogItemPhoto('ws', 'item', res)

    expect(documents.getItemPhoto).toHaveBeenCalledWith('ws', 'item')
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Length': '3',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(res.send).toHaveBeenCalledWith(Buffer.from('png'))
  })
})
