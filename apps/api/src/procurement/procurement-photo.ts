import { dirname } from 'path'
import { BadRequestException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'
import sharp, { type OutputInfo } from 'sharp'

// Small VPS: one libvips worker, no pixel cache, so five 12MP phone photos
// cannot pile up in memory. Both settings are PROCESS-GLOBAL: they apply to every
// sharp user in this API process (catalog photos too), not just this module.
sharp.concurrency(1)
sharp.cache(false)

// sharp.concurrency(1) limits threads per decode, not decodes in flight, so
// concurrent uploads would still hold several 50MP decodes in memory at once.
// A process-wide promise queue lets exactly one normalizePhoto decode run.
let decodeQueue: Promise<unknown> = Promise.resolve()

function withDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
  const run = decodeQueue.then(task, task)
  // The queue only orders; a failed task must not poison the next one.
  decodeQueue = run.catch(() => undefined)
  return run
}

export const MAX_PHOTO_PAGES = 5
export const MAX_PHOTO_EDGE = 2048
export const MAX_INPUT_PIXELS = 50_000_000

export type PhotoImageType = 'jpeg' | 'png' | 'webp' | 'heic'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

export class PhotoInputError extends BadRequestException {}

export function detectImageType(buf: Buffer): PhotoImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg'
  }
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png'
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp'
  }
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.has(buf.toString('latin1', 8, 12))) {
    return 'heic'
  }
  return null
}

/**
 * Upright, at most 2048px, JPEG, no metadata. sharp drops EXIF (GPS included)
 * unless `withMetadata()` is called, which this never does.
 */
export async function normalizePhoto(buf: Buffer, n: number): Promise<{ data: Buffer; info: OutputInfo }> {
  const type = detectImageType(buf)
  if (type === 'heic') {
    throw new PhotoInputError('HEIC/HEIF photos are not supported — export as JPEG and upload again')
  }
  if (type === null) {
    throw new PhotoInputError(`Photo ${n} is not a JPEG, PNG or WebP image`)
  }

  try {
    return await withDecodeSlot(() =>
      sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: MAX_PHOTO_EDGE, height: MAX_PHOTO_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('pixel limit') || message.includes('exceeds')) {
      throw new PhotoInputError(`Photo ${n} is too large to process`)
    }
    throw new PhotoInputError(`Photo ${n} could not be read`)
  }
}

export async function stitchPagesToPdf(pages: Buffer[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const page of pages) {
    const image = await pdf.embedJpg(page)
    const pdfPage = pdf.addPage([image.width, image.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  return pdf.save()
}

export function photoStorageKey(workspaceId: string, kind: string, uuid: string, pdfName: string): string {
  return `${workspaceId}/procurement/${kind}/${uuid}-pages/${pdfName}`
}

export function photoPageKey(storageKey: string, n: number): string {
  return `${dirname(storageKey)}/${n}.jpg`
}
