import { describe, expect, it } from 'vitest'
import { isUnauthorized } from './handle-unauthorized'

describe('isUnauthorized', () => {
  it('matches statusCode 401', () => {
    expect(isUnauthorized({ statusCode: 401 })).toBe(true)
  })

  it('matches Unauthorized message', () => {
    expect(isUnauthorized({ message: 'Unauthorized' })).toBe(true)
  })

  it('returns false for other values', () => {
    expect(isUnauthorized({ statusCode: 403, message: 'Forbidden' })).toBe(false)
    expect(isUnauthorized(null)).toBe(false)
  })
})
