import { describe, expect, it } from 'vitest'
import { isForbidden, isUnauthorized } from './handle-unauthorized'

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

// B14. WorkspaceMemberGuard answers 403 to anyone who is not a member of the
// workspace in the URL (or when the workspace does not exist). A page reads
// that as "no access", never as "empty".
describe('isForbidden (B14)', () => {
  it('edge: does not match a 401, which means signed out, not denied', () => {
    expect(isForbidden({ statusCode: 401, message: 'Unauthorized' })).toBe(false)
  })

  it('edge: does not match a non-object', () => {
    expect(isForbidden(null)).toBe(false)
    expect(isForbidden('Forbidden')).toBe(false)
  })

  it('happy: matches a 403', () => {
    expect(isForbidden({ statusCode: 403, message: 'Not a member of this workspace' })).toBe(true)
  })
})
})
