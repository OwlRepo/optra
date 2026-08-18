// Cached embedding layer for the demo seeder.
//
// Wraps @repo/ai's embedChunks (packages/ai/src/embeddings/index.ts) — the same
// OpenAI path the real ingest pipeline uses — and memoizes every vector to
// scripts/seed/embeddings-cache.json. The cache is committed on purpose: it
// makes re-seeding free, instant and offline, so a demo never depends on
// network reachability or an OpenAI key being present on the machine.
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { EMBEDDING_DIMENSION } from './config'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CACHE_PATH = join(HERE, 'embeddings-cache.json')

// 6 decimals keeps cosine similarity indistinguishable from full precision
// while cutting the committed cache file to roughly a third of its size.
const PRECISION = 6

export interface EmbeddingCacheFile {
  model: string
  vectors: Record<string, number[]>
}

export function cacheKey(model: string, text: string): string {
  return createHash('sha256').update(`${model}\n${text}`).digest('hex')
}

export function roundVector(vector: number[]): number[] {
  const factor = 10 ** PRECISION
  return vector.map(v => Math.round(v * factor) / factor)
}

function currentModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small'
}

export function loadCache(path = CACHE_PATH): EmbeddingCacheFile {
  const model = currentModel()
  if (!existsSync(path)) {
    return { model, vectors: {} }
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as EmbeddingCacheFile
  return { model: parsed.model ?? model, vectors: parsed.vectors ?? {} }
}

export function saveCache(cache: EmbeddingCacheFile, path = CACHE_PATH): void {
  writeFileSync(path, `${JSON.stringify(cache)}\n`, 'utf8')
}

export interface EmbedderOptions {
  /** Injected in tests; defaults to the real @repo/ai embedder. */
  embed?: (texts: string[]) => Promise<number[][]>
  cachePath?: string
  /** Skip OpenAI entirely and return nulls. Rows still insert. */
  disabled?: boolean
  onProgress?: (message: string) => void
}

async function defaultEmbed(texts: string[]): Promise<number[][]> {
  // Imported lazily so --no-embeddings runs never pull in the LangChain graph
  // (and never fail on a missing OPENAI_API_KEY).
  const { embedChunks } = await import('@repo/ai')
  const chunks = texts.map((content, index) => ({
    content,
    contentHash: String(index),
    metadata: {},
  }))
  const embedded = await embedChunks(chunks as never)
  return embedded.map(e => e.embedding)
}

/**
 * Returns one vector per input text, in order. Cache hits cost nothing; only
 * the misses are sent to OpenAI, in a single batch, and written back to disk.
 * With `disabled`, every result is null — chunks still insert, they just score
 * last in vector search.
 */
export async function getEmbeddings(
  texts: string[],
  options: EmbedderOptions = {},
): Promise<(number[] | null)[]> {
  if (options.disabled) {
    return texts.map(() => null)
  }

  const path = options.cachePath ?? CACHE_PATH
  const model = currentModel()
  const cache = loadCache(path)

  // A model switch invalidates every vector — dimensions and geometry differ.
  if (cache.model !== model) {
    cache.model = model
    cache.vectors = {}
  }

  const keys = texts.map(text => cacheKey(model, text))
  const missingIndexes = keys
    .map((key, index) => (cache.vectors[key] ? -1 : index))
    .filter(index => index !== -1)

  // The same text twice in one batch would otherwise be embedded twice.
  const uniqueMissing = [...new Map(missingIndexes.map(i => [keys[i]!, i])).values()]

  if (uniqueMissing.length > 0) {
    options.onProgress?.(
      `embedding ${uniqueMissing.length} new text(s) via ${model} (${texts.length - uniqueMissing.length} cached)`,
    )
    const embed = options.embed ?? defaultEmbed
    const vectors = await embed(uniqueMissing.map(i => texts[i]!))

    vectors.forEach((vector, n) => {
      if (vector.length !== EMBEDDING_DIMENSION) {
        throw new Error(
          `embedding model returned ${vector.length} dimensions, expected ${EMBEDDING_DIMENSION}`,
        )
      }
      cache.vectors[keys[uniqueMissing[n]!]!] = roundVector(vector)
    })

    saveCache(cache, path)
  } else {
    options.onProgress?.(`all ${texts.length} embedding(s) served from cache`)
  }

  return keys.map(key => cache.vectors[key] ?? null)
}
