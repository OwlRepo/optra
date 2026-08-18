// Free stock photography for seeded catalog items.
//
// Source: Pexels (https://www.pexels.com). The Pexels License allows free use
// including commercially, with modification, and without attribution — which is
// what makes these safe to bake into a demo tenant that also runs in production.
// Every URL below was fetched and visually checked, so the `subject` label
// genuinely describes the photo; nothing is captioned as something it isn't.
//
// Bytes are cached under scripts/seed/.image-cache/ (gitignored) so repeat runs
// do no network I/O, and a download failure is always non-fatal — the item just
// falls back to the placeholder tile it renders today.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const IMAGE_CACHE_DIR = join(HERE, '.image-cache')

const PEXELS = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=600`

export interface StockImage {
  key: string
  url: string
  /** What the photo actually shows — verified by eye, not guessed from the id. */
  subject: string
}

export const IMAGE_LIBRARY: StockImage[] = [
  // Furniture and workspace
  { key: 'desk-chair', url: PEXELS(1957478), subject: 'wooden desk with a mesh task chair' },
  { key: 'desk-shelving', url: PEXELS(667838), subject: 'wooden desk with wall shelving' },
  { key: 'seating-showroom', url: PEXELS(276528), subject: 'furniture showroom seating' },
  { key: 'desk-lamp-scene', url: PEXELS(265072), subject: 'desk with an angled task lamp' },
  { key: 'desk-lamp', url: PEXELS(1112598), subject: 'black adjustable desk lamp beside a plant' },
  { key: 'vase-decor', url: PEXELS(4207892), subject: 'ceramic vase with dried grass' },

  // Computing hardware
  { key: 'laptop-wood', url: PEXELS(205421), subject: 'silver laptop on a wooden surface' },
  { key: 'laptop-blank', url: PEXELS(6446709), subject: 'laptop with a blank screen on green' },
  { key: 'laptop-dark', url: PEXELS(1229861), subject: 'laptop on a dark desk' },
  { key: 'laptop-dashboard', url: PEXELS(577210), subject: 'laptop displaying analytics dashboards' },
  { key: 'monitor-desktop', url: PEXELS(1029757), subject: 'large desktop monitor on a white desk' },
  { key: 'monitor-camera', url: PEXELS(4491461), subject: 'desk monitor with a camera on a tripod' },
  { key: 'keyboard-mouse', url: PEXELS(3944405), subject: 'white keyboard and mouse, top down' },
  { key: 'earbuds', url: PEXELS(8534088), subject: 'wireless earbuds and charging case' },
  { key: 'components', url: PEXELS(1476321), subject: 'disassembled electronic components' },
  { key: 'laptop-bar', url: PEXELS(2115217), subject: 'person typing on a laptop at a wooden bar' },
  { key: 'laptop-phone', url: PEXELS(1181244), subject: 'laptop showing code beside a phone' },
  { key: 'laptop-plants', url: PEXELS(7014337), subject: 'laptop on a desk surrounded by plants' },
  { key: 'laptop-call', url: PEXELS(7014925), subject: 'laptop on a video call' },

  // Consumables and facilities
  { key: 'coffee-beans', url: PEXELS(585753), subject: 'mug of coffee on roasted beans' },
  { key: 'coffee-cups', url: PEXELS(2074130), subject: 'coffee cups on a shared table' },
  { key: 'scissors', url: PEXELS(4226896), subject: 'black office scissors' },
  { key: 'cleaning-sponge', url: PEXELS(4239146), subject: 'gloved hand cleaning glass with a sponge' },
  { key: 'cleaning-squeegee', url: PEXELS(4239091), subject: 'gloved hand cleaning tile with a squeegee' },
  { key: 'facilities-mop', url: PEXELS(6197123), subject: 'facilities worker with a cleaning pole' },
  { key: 'boxes', url: PEXELS(4498124), subject: 'two open cardboard shipping boxes' },
  { key: 'packing-box', url: PEXELS(4498138), subject: 'hands packing goods into a cardboard box' },
]

const BY_KEY = new Map(IMAGE_LIBRARY.map(image => [image.key, image]))

export function imageSubject(key: string): string {
  return BY_KEY.get(key)?.subject ?? key
}

/**
 * Returns the JPEG bytes for each requested key. Cached on disk after the first
 * download. Keys that cannot be fetched are simply absent from the map — the
 * caller leaves photoStorageKey null for those, which is the same state the
 * seeder produced before images existed.
 */
export async function fetchImages(
  keys: string[],
  onProgress?: (message: string) => void,
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>()
  const wanted = [...new Set(keys)]

  if (!existsSync(IMAGE_CACHE_DIR)) {
    mkdirSync(IMAGE_CACHE_DIR, { recursive: true })
  }

  let downloaded = 0
  let cached = 0

  for (const key of wanted) {
    const image = BY_KEY.get(key)
    if (!image) continue

    const path = join(IMAGE_CACHE_DIR, `${key}.jpg`)
    if (existsSync(path)) {
      result.set(key, readFileSync(path))
      cached += 1
      continue
    }

    try {
      const response = await fetch(image.url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 2000) throw new Error(`suspiciously small response (${buffer.length} bytes)`)
      writeFileSync(path, buffer)
      result.set(key, buffer)
      downloaded += 1
    } catch (error) {
      onProgress?.(
        `WARNING: could not fetch stock image "${key}" (${(error as Error).message}) — item will show the placeholder tile`,
      )
    }
  }

  onProgress?.(
    `images: ${cached} from cache, ${downloaded} downloaded, ${wanted.length - cached - downloaded} unavailable`,
  )
  return result
}
