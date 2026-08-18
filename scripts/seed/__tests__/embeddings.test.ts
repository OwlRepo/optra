import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSION } from '../config'
import { cacheKey, getEmbeddings, loadCache, roundVector } from '../embeddings'

function fakeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => Math.sin(seed + i) / 2)
}

describe('seed embedding cache', () => {
  let dir: string
  let cachePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seed-embed-'))
    cachePath = join(dir, 'cache.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keys on the model name so switching models invalidates vectors', () => {
    expect(cacheKey('text-embedding-3-small', 'hello')).not.toBe(cacheKey('text-embedding-3-large', 'hello'))
    expect(cacheKey('text-embedding-3-small', 'hello')).toBe(cacheKey('text-embedding-3-small', 'hello'))
  })

  it('rounds to 6 decimals and survives a JSON round trip', () => {
    const rounded = roundVector([0.123456789, -0.987654321])
    expect(rounded).toEqual([0.123457, -0.987654])
    expect(JSON.parse(JSON.stringify(rounded))).toEqual(rounded)
  })

  it('embeds on a miss, writes the cache, then serves later calls from disk', async () => {
    let calls = 0
    const embed = async (texts: string[]) => {
      calls += 1
      return texts.map((_, i) => fakeVector(i))
    }

    const first = await getEmbeddings(['alpha', 'beta'], { embed, cachePath })
    expect(calls).toBe(1)
    expect(first[0]).toHaveLength(EMBEDDING_DIMENSION)
    expect(existsSync(cachePath)).toBe(true)

    const second = await getEmbeddings(['alpha', 'beta'], { embed, cachePath })
    expect(calls).toBe(1) // no second OpenAI round trip
    expect(second).toEqual(first)

    const onDisk = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(Object.keys(onDisk.vectors)).toHaveLength(2)
  })

  it('only sends the missing texts when part of the batch is cached', async () => {
    const seen: string[][] = []
    const embed = async (texts: string[]) => {
      seen.push(texts)
      return texts.map((_, i) => fakeVector(i))
    }

    await getEmbeddings(['alpha'], { embed, cachePath })
    await getEmbeddings(['alpha', 'gamma'], { embed, cachePath })

    expect(seen).toEqual([['alpha'], ['gamma']])
  })

  it('deduplicates repeated text inside one batch', async () => {
    const seen: string[][] = []
    const embed = async (texts: string[]) => {
      seen.push(texts)
      return texts.map((_, i) => fakeVector(i))
    }

    const result = await getEmbeddings(['same', 'same'], { embed, cachePath })
    expect(seen).toEqual([['same']])
    expect(result[0]).toEqual(result[1])
  })

  it('rejects a vector whose dimension is not 1536', async () => {
    const embed = async () => [[0.1, 0.2, 0.3]]
    await expect(getEmbeddings(['alpha'], { embed, cachePath })).rejects.toThrow(/3 dimensions, expected 1536/)
  })

  it('returns nulls and never calls the embedder when disabled', async () => {
    let calls = 0
    const embed = async (texts: string[]) => {
      calls += 1
      return texts.map(() => fakeVector(0))
    }
    const result = await getEmbeddings(['alpha', 'beta'], { embed, cachePath, disabled: true })
    expect(result).toEqual([null, null])
    expect(calls).toBe(0)
  })

  it('treats a missing cache file as an empty cache', () => {
    const cache = loadCache(join(dir, 'does-not-exist.json'))
    expect(cache.vectors).toEqual({})
  })
})
