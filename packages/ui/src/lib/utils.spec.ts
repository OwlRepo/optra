import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('edge: drops falsy inputs', () => {
    expect(cn('px-2', false, null, undefined, '')).toBe('px-2')
  })

  it('edge: a later conflicting Tailwind class replaces the earlier one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('edge: arbitrary values conflict with named ones in the same group', () => {
    expect(cn('rounded-[12px]', 'rounded-full')).toBe('rounded-full')
  })

  it('happy: joins conditional object and nested array inputs', () => {
    expect(cn('a', { b: true, c: false }, ['d', ['e']])).toBe('a b d e')
  })
})
