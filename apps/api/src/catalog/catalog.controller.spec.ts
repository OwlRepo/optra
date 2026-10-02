import { ParseUUIDPipe } from '@nestjs/common'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
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

// B13. A path param gets no class-validator pass, so a malformed :vendorId or
// :catalogId reached a uuid query and Postgres answered 22P02, which surfaced
// as a 500. Every id the catalog routes take from the path must be parsed as a
// UUID first, the way :itemId, :matchId and the verify route's :vendorId are.
describe('CatalogController path ids (B13)', () => {
  const routesWithIds: Array<[keyof CatalogController, string[]]> = [
    ['getVendor', ['vendorId']],
    ['vendorPriceHistory', ['vendorId']],
    ['vendorExceptionSummary', ['vendorId']],
    ['createPriceTerm', ['vendorId']],
    ['listPriceTerms', ['vendorId']],
    ['uploadCatalog', ['vendorId']],
    ['scrapeCatalog', ['vendorId']],
    ['listCatalogs', ['vendorId']],
    ['listCatalogItems', ['vendorId', 'catalogId']],
    ['catalogItemPhoto', ['itemId']],
    ['verifyMatches', ['vendorId']],
    ['dismissMatch', ['matchId']],
  ]

  it('error: every id taken from the path is parsed as a UUID before the handler runs', () => {
    const missing: string[] = []
    for (const [handler, params] of routesWithIds) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, CatalogController, handler) as Record<
        string,
        { data?: string; pipes?: unknown[] }
      >
      for (const param of params) {
        const arg = Object.values(args).find((entry) => entry.data === param)
        const parsed = arg?.pipes?.some((pipe) => pipe instanceof ParseUUIDPipe || pipe === ParseUUIDPipe) ?? false
        if (!parsed) missing.push(`${String(handler)}(:${param})`)
      }
    }

    expect(missing).toEqual([])
  })
})

