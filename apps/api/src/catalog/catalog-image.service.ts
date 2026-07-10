import { randomUUID } from 'crypto'
import { Injectable, Logger } from '@nestjs/common'
import { assertPublicUrl } from '@repo/ai'
import { StorageService } from '../storage/storage.service'

const IMAGE_FETCH_TIMEOUT_MS = 20_000

function maxImageBytes(): number {
  return Number(process.env.CATALOG_IMAGE_MAX_BYTES ?? 5 * 1024 * 1024)
}

// The new SSRF surface for A3: unlike crawlSite (which only ever fetches
// HTML pages under assertPublicUrl), this fetches arbitrary image URLs
// found in scraped HTML or CSV `photo_url` columns — same guard, plus a
// size cap the crawler doesn't need (crawlSite never buffers a full body).
@Injectable()
export class CatalogImageService {
  private readonly logger = new Logger(CatalogImageService.name)

  constructor(private readonly storage: StorageService) {}

  async fetchAndStore(workspaceId: string, catalogId: string, imageUrl: string): Promise<string | null> {
    try {
      await assertPublicUrl(imageUrl)

      const response = await fetch(imageUrl, {
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        redirect: 'manual',
      })

      if (!response.ok) {
        throw new Error(`Image fetch failed: HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        throw new Error(`Unsupported content-type for image: ${contentType || '(none)'}`)
      }

      const buffer = await this.readWithSizeCap(response, maxImageBytes())
      const extension = contentType.split('/')[1]?.split(';')[0] ?? 'bin'
      const key = `${workspaceId}/catalogs/${catalogId}/images/${randomUUID()}.${extension}`
      await this.storage.save(key, buffer, contentType)

      return key
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Catalog image fetch failed url=${imageUrl}: ${message}`)
      return null
    }
  }

  private async readWithSizeCap(response: Response, maxBytes: number): Promise<Buffer> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Image response has no body')
    }

    const chunks: Uint8Array[] = []
    let total = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          throw new Error(`Image exceeds ${maxBytes} byte limit`)
        }
        chunks.push(value)
      }
    }

    return Buffer.concat(chunks)
  }
}
