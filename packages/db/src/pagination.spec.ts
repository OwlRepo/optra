import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  buildOffsetResult,
  decodeCursor,
  encodeCursor,
  resolveOffsetPage,
  type Cursor,
} from './pagination'

describe('pagination cursor helpers', () => {
  it('round-trips cursor payloads exactly', () => {
    const cursor: Cursor = {
      k: ['2026-07-01T12:34:56.000Z', 42],
      id: 'row-123',
    }

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it.each([
    '%%%not-base64%%%',
    Buffer.from('not-json', 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ id: 'row-1' }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ k: ['x'] }), 'utf8').toString('base64url'),
  ])('throws BadRequestException for invalid cursor %s', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException)
  })
})

describe('resolveOffsetPage', () => {
  it('defaults to page 1, pageSize 20, offset 0 when nothing supplied', () => {
    expect(resolveOffsetPage()).toEqual({ page: 1, pageSize: 20, offset: 0 })
  })

  it('honors a custom default pageSize when page size is omitted', () => {
    expect(resolveOffsetPage(undefined, undefined, { pageSize: 5 })).toEqual({
      page: 1,
      pageSize: 5,
      offset: 0,
    })
  })

  it('computes offset from page and pageSize (accepts numeric strings)', () => {
    expect(resolveOffsetPage('3', '10')).toEqual({ page: 3, pageSize: 10, offset: 20 })
  })

  it('clamps pageSize into 1..100 and page to >= 1', () => {
    expect(resolveOffsetPage('0', '999')).toEqual({ page: 1, pageSize: 100, offset: 0 })
    expect(resolveOffsetPage('-4', '0')).toEqual({ page: 1, pageSize: 20, offset: 0 })
  })

  it('falls back to defaults for non-numeric input', () => {
    expect(resolveOffsetPage('abc', 'xyz')).toEqual({ page: 1, pageSize: 20, offset: 0 })
  })
})

describe('buildOffsetResult', () => {
  it('wraps items with page metadata and computes totalPages', () => {
    expect(buildOffsetResult(['a', 'b'], 42, 2, 10)).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 10,
      total: 42,
      totalPages: 5,
    })
  })

  it('reports zero total pages for an empty result set', () => {
    expect(buildOffsetResult([], 0, 1, 20)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    })
  })
})
