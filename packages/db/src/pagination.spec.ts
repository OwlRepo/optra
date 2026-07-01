import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, type Cursor } from './pagination'

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
