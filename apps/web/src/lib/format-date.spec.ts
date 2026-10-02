import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './format-date'

// Dates are built from local-time parts, so every expectation holds in any TZ
// the runner happens to use.
describe('formatDate / formatDateTime', () => {
  it('error: an unparseable string reads as a dash', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('error: an invalid Date reads as a dash', () => {
    expect(formatDate(new Date(Number.NaN))).toBe('—')
    expect(formatDateTime(new Date('nope'))).toBe('—')
  })

  it('edge: single-digit month, day, hour and minute are zero-padded', () => {
    const date = new Date(2026, 0, 5, 7, 3)

    expect(formatDate(date)).toBe('2026-01-05')
    expect(formatDateTime(date)).toBe('2026-01-05 07:03')
  })

  it('edge: renders local time, not UTC, across a year boundary', () => {
    const date = new Date(2026, 11, 31, 23, 59)

    expect(formatDate(date.toISOString())).toBe('2026-12-31')
    expect(formatDateTime(date.toISOString())).toBe('2026-12-31 23:59')
  })

  it('happy: accepts an ISO string', () => {
    const iso = new Date(2026, 9, 2, 9, 14).toISOString()

    expect(formatDate(iso)).toBe('2026-10-02')
    expect(formatDateTime(iso)).toBe('2026-10-02 09:14')
  })

  it('happy: accepts a Date', () => {
    const date = new Date(2026, 1, 11, 16, 2)

    expect(formatDate(date)).toBe('2026-02-11')
    expect(formatDateTime(date)).toBe('2026-02-11 16:02')
  })
})
