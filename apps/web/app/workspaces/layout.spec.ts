import { describe, expect, it } from 'vitest'
import { metadata } from './layout'

describe('workspaces layout metadata', () => {
  it('excludes the authenticated workspaces app-shell subtree from search indexing', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
