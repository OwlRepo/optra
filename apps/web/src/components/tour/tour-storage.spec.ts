import { describe, expect, it } from 'vitest'
import { readTourRecord, tourStorageKey, writeTourRecord } from './tour-storage'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError: storage blocked')
  }
  return {
    get length() {
      return 0
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

describe('tour-storage', () => {
  it('error: readTourRecord returns null when getItem throws', () => {
    expect(readTourRecord('user-1', throwingStorage())).toBeNull()
  })

  it('error: writeTourRecord does not throw when setItem throws', () => {
    expect(() => writeTourRecord('user-1', 'completed', new Date(), throwingStorage())).not.toThrow()
  })

  it('error: both calls are safe when no storage is available', () => {
    expect(readTourRecord('user-1', null)).toBeNull()
    expect(() => writeTourRecord('user-1', 'skipped', new Date(), null)).not.toThrow()
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a JSON string, not an object', '"completed"'],
    ['an unknown status', JSON.stringify({ status: 'abandoned', at: '2026-10-03T00:00:00.000Z' })],
    ['a missing at', JSON.stringify({ status: 'completed' })],
    ['a non-string at', JSON.stringify({ status: 'completed', at: 12345 })],
    ['null', 'null'],
  ])('edge: %s reads as null', (_label, raw) => {
    const storage = memoryStorage({ [tourStorageKey('user-1')]: raw })
    expect(readTourRecord('user-1', storage)).toBeNull()
  })

  it("edge: another user's record is not returned", () => {
    const storage = memoryStorage()
    writeTourRecord('user-2', 'completed', new Date('2026-10-03T00:00:00.000Z'), storage)
    expect(readTourRecord('user-1', storage)).toBeNull()
    expect(readTourRecord('user-2', storage)).not.toBeNull()
  })

  it('regression: the key is versioned and scoped per user', () => {
    expect(tourStorageKey('abc')).toBe('optra.tour.v1:abc')
  })

  it.each(['completed', 'skipped'] as const)('happy: writes then reads %s with the injected ISO time', (status) => {
    const storage = memoryStorage()
    const now = new Date('2026-10-03T12:34:56.000Z')

    writeTourRecord('user-1', status, now, storage)

    expect(readTourRecord('user-1', storage)).toEqual({ status, at: '2026-10-03T12:34:56.000Z' })
    expect(JSON.parse(storage.getItem('optra.tour.v1:user-1') as string)).toEqual({
      status,
      at: '2026-10-03T12:34:56.000Z',
    })
  })
})
