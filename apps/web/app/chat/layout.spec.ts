import { describe, expect, it } from 'vitest'
import { metadata } from './layout'

describe('chat layout metadata', () => {
  it('excludes the authenticated chat app-shell from search indexing', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
