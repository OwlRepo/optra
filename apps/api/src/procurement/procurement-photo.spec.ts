import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_PHOTO_PAGES,
  PhotoInputError,
  detectImageType,
  normalizePhoto,
  photoPageKey,
  photoStorageKey,
  stitchPagesToPdf,
} from './procurement-photo'

// Real sharp, no mocks: the point of these specs is what libvips does to real bytes.

async function jpeg(width: number, height: number, orientation?: number, withGps = false): Promise<Buffer> {
  let image = sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).jpeg()
  if (orientation !== undefined) {
    image = image.withMetadata({ orientation })
  }
  let buffer = await image.toBuffer()
  if (withGps) {
    buffer = await sharp(buffer)
      .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 35/1 0/1' } })
      .toBuffer()
  }
  return buffer
}

function heicBuffer(brand = 'mif1'): Buffer {
  const buf = Buffer.alloc(32)
  buf.writeUInt32BE(24, 0)
  buf.write('ftyp', 4, 'latin1')
  buf.write(brand, 8, 'latin1')
  return buf
}

describe('procurement-photo', () => {
  describe('detectImageType', () => {
    it('error: random bytes are not an image', () => {
      expect(detectImageType(Buffer.from('definitely not an image, just text'))).toBeNull()
    })

    it('error: an empty buffer is not an image', () => {
      expect(detectImageType(Buffer.alloc(0))).toBeNull()
    })

    it('edge: a RIFF container that is not WebP is not an image', () => {
      const riff = Buffer.alloc(16)
      riff.write('RIFF', 0, 'latin1')
      riff.write('WAVE', 8, 'latin1')
      expect(detectImageType(riff)).toBeNull()
    })

    it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])(
      'edge: HEIF brand %s is recognised as heic',
      (brand) => {
        expect(detectImageType(heicBuffer(brand))).toBe('heic')
      },
    )

    it('edge: an ftyp box with an unrelated brand (mp4) is not heic', () => {
      expect(detectImageType(heicBuffer('isom'))).toBeNull()
    })

    it('happy: recognises JPEG, PNG and WebP by magic bytes, ignoring the file name', async () => {
      expect(detectImageType(await jpeg(10, 10))).toBe('jpeg')
      expect(detectImageType(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer())).toBe('png')
      expect(detectImageType(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('webp')
    })
  })

  describe('normalizePhoto', () => {
    it('error: HEIC brand mif1 throws the HEIC message', async () => {
      const err = await normalizePhoto(heicBuffer('mif1'), 1).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PhotoInputError)
      expect((err as Error).message).toBe('HEIC/HEIF photos are not supported — export as JPEG and upload again')
    })

    it('error: random bytes throw "Photo N is not a JPEG, PNG or WebP image" with the 1-based index', async () => {
      const err = await normalizePhoto(Buffer.from('plain text pretending to be a photo'), 3).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PhotoInputError)
      expect((err as Error).message).toBe('Photo 3 is not a JPEG, PNG or WebP image')
    })

    it('error: a truncated JPEG throws "Photo N could not be read"', async () => {
      const whole = await jpeg(400, 300)
      const err = await normalizePhoto(whole.subarray(0, 600), 2).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PhotoInputError)
      expect((err as Error).message).toBe('Photo 2 could not be read')
    })

    it('error: an image over the 50MP pixel limit throws "Photo N is too large to process"', async () => {
      // 8000x7000 = 56MP of flat colour: tiny as a PNG, over MAX_INPUT_PIXELS when decoded.
      const huge = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#ffffff' } })
        .png({ compressionLevel: 9 })
        .toBuffer()
      const err = await normalizePhoto(huge, 1).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PhotoInputError)
      expect((err as Error).message).toBe('Photo 1 is too large to process')
    })

    it('edge: EXIF orientation 6 is applied: output width and height are swapped', async () => {
      const input = await jpeg(400, 300, 6)
      expect((await sharp(input).metadata()).orientation).toBe(6)

      const { data, info } = await normalizePhoto(input, 1)

      expect(info.width).toBe(300)
      expect(info.height).toBe(400)
      const meta = await sharp(data).metadata()
      expect(meta.width).toBe(300)
      expect(meta.height).toBe(400)
    })

    it('edge: output carries no EXIF at all, so GPS is gone', async () => {
      const input = await jpeg(400, 300, 6, true)
      expect((await sharp(input).metadata()).exif).toBeDefined()

      const { data } = await normalizePhoto(input, 1)

      const meta = await sharp(data).metadata()
      expect(meta.exif).toBeUndefined()
      expect(meta.orientation).toBeUndefined()
    })

    it('edge: a 4000px-wide photo is scaled so the long edge is 2048', async () => {
      const { data, info } = await normalizePhoto(await jpeg(4000, 3000), 1)

      expect(info.width).toBe(2048)
      expect(info.height).toBe(1536)
      expect((await sharp(data).metadata()).width).toBe(2048)
    })

    it('edge: orientation 6 on a 4000x3000 photo ends up 1536x2048 (rotate first, then fit)', async () => {
      const { info } = await normalizePhoto(await jpeg(4000, 3000, 6), 1)

      expect(info.width).toBe(1536)
      expect(info.height).toBe(2048)
    })

    it('edge: an 800px photo is not enlarged', async () => {
      const { info } = await normalizePhoto(await jpeg(800, 600), 1)

      expect(info.width).toBe(800)
      expect(info.height).toBe(600)
    })

    it('edge: PNG and WebP inputs come out as JPEG', async () => {
      const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#336699' } }).png().toBuffer()
      const webp = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#336699' } }).webp().toBuffer()

      for (const input of [png, webp]) {
        const { data } = await normalizePhoto(input, 1)
        expect(detectImageType(data)).toBe('jpeg')
        expect((await sharp(data).metadata()).format).toBe('jpeg')
      }
    })

    it('edge: two concurrent normalizePhoto calls never decode at the same time', async () => {
      const a = await jpeg(400, 300)
      const b = await jpeg(300, 400)
      let active = 0
      let peak = 0
      const spy = jest.spyOn(sharp.prototype, 'toBuffer').mockImplementation(function (this: unknown) {
        active += 1
        peak = Math.max(peak, active)
        return new Promise((resolve) => {
          setTimeout(() => {
            active -= 1
            resolve({ data: Buffer.from('x'), info: {} })
          }, 20)
        }) as never
      })

      try {
        await Promise.all([normalizePhoto(a, 1), normalizePhoto(b, 2), normalizePhoto(a, 3)])
      } finally {
        spy.mockRestore()
      }

      expect(peak).toBe(1)
    })

    it('regression: a failing decode releases the slot so the next photo still runs', async () => {
      await expect(normalizePhoto(await jpeg(100, 100).then((j) => j.subarray(0, 40)), 1)).rejects.toBeInstanceOf(PhotoInputError)

      const ok = await normalizePhoto(await jpeg(100, 100), 2)

      expect(ok.info.format).toBe('jpeg')
    })

    it('happy: a normal JPEG comes back as a JPEG buffer', async () => {
      const { data, info } = await normalizePhoto(await jpeg(640, 480), 1)

      expect(Buffer.isBuffer(data)).toBe(true)
      expect(info.format).toBe('jpeg')
    })
  })

  describe('stitchPagesToPdf', () => {
    it('edge: a single page makes a 1-page PDF', async () => {
      const pdf = await stitchPagesToPdf([(await normalizePhoto(await jpeg(300, 200), 1)).data])

      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
    })

    it('edge: each PDF page takes the size of its image', async () => {
      const a = (await normalizePhoto(await jpeg(300, 200), 1)).data
      const b = (await normalizePhoto(await jpeg(200, 500), 2)).data

      const doc = await PDFDocument.load(await stitchPagesToPdf([a, b]))

      expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 200 })
      expect(doc.getPage(1).getSize()).toEqual({ width: 200, height: 500 })
    })

    it('happy: 3 pages make a 3-page PDF starting with %PDF', async () => {
      const pages = await Promise.all([1, 2, 3].map(async (n) => (await normalizePhoto(await jpeg(300, 200), n)).data))

      const pdf = await stitchPagesToPdf(pages)

      expect(Buffer.from(pdf).subarray(0, 4).toString('latin1')).toBe('%PDF')
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3)
    })
  })

  describe('storage keys', () => {
    it('edge: the stitched PDF lives in a "-pages" folder beside its page images', () => {
      const key = photoStorageKey('ws-1', 'invoice', 'uuid-1', 'inv.pdf')

      expect(key).toBe('ws-1/procurement/invoice/uuid-1-pages/inv.pdf')
    })

    it('edge: page n is <dir>/<n>.jpg', () => {
      const key = photoStorageKey('ws-1', 'purchase_order', 'uuid-1', 'po.pdf')

      expect(photoPageKey(key, 1)).toBe('ws-1/procurement/purchase_order/uuid-1-pages/1.jpg')
      expect(photoPageKey(key, 5)).toBe('ws-1/procurement/purchase_order/uuid-1-pages/5.jpg')
    })

    it('happy: MAX_PHOTO_PAGES is 5', () => {
      expect(MAX_PHOTO_PAGES).toBe(5)
    })
  })
})
