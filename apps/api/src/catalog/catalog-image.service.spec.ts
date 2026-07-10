import { assertPublicUrl } from '@repo/ai'
import { CatalogImageService } from './catalog-image.service'
import { StorageService } from '../storage/storage.service'

jest.mock('@repo/ai', () => ({
  assertPublicUrl: jest.fn(),
}))

function fakeResponse(options: { ok: boolean; status?: number; contentType?: string; chunks?: Uint8Array[] }) {
  const chunks = options.chunks ?? []
  let index = 0

  return {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 403),
    headers: { get: () => options.contentType ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const value = chunks[index]
            index += 1
            return { done: false, value }
          }
          return { done: true, value: undefined }
        },
      }),
    },
  } as unknown as Response
}

describe('CatalogImageService', () => {
  let service: CatalogImageService
  let storage: { save: jest.Mock }
  let fetchMock: jest.Mock
  const originalMaxBytes = process.env.CATALOG_IMAGE_MAX_BYTES

  beforeEach(() => {
    storage = { save: jest.fn().mockResolvedValue(undefined) }
    service = new CatalogImageService(storage as unknown as StorageService)
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    ;(assertPublicUrl as jest.Mock).mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.clearAllMocks()
    process.env.CATALOG_IMAGE_MAX_BYTES = originalMaxBytes
  })

  it('returns null when the URL is not public', async () => {
    ;(assertPublicUrl as jest.Mock).mockRejectedValue(new Error('Blocked non-public URL'))

    const result = await service.fetchAndStore('ws-1', 'cat-1', 'http://169.254.169.254/image.png')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when the content-type is not an image', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: true, contentType: 'text/html' }))

    const result = await service.fetchAndStore('ws-1', 'cat-1', 'https://vendor.example.com/page.html')

    expect(result).toBeNull()
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('returns null when the body exceeds the size cap', async () => {
    process.env.CATALOG_IMAGE_MAX_BYTES = '10'
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: true, contentType: 'image/png', chunks: [new Uint8Array(20)] }),
    )

    const result = await service.fetchAndStore('ws-1', 'cat-1', 'https://vendor.example.com/big.png')

    expect(result).toBeNull()
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('stores and returns a key for a valid small image', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    fetchMock.mockResolvedValue(fakeResponse({ ok: true, contentType: 'image/png', chunks: [bytes] }))

    const key = await service.fetchAndStore('ws-1', 'cat-1', 'https://vendor.example.com/photo.png')

    expect(key).toContain('ws-1/catalogs/cat-1/images/')
    expect(storage.save).toHaveBeenCalledWith(key, Buffer.from(bytes), 'image/png')
  })
})
