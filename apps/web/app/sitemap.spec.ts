import { describe, expect, it } from 'vitest'
import sitemap from './sitemap'

describe('sitemap', () => {
  it('lists the public marketing homepage on the real deployed domain', () => {
    const result = sitemap()
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://mnemra.tyvera.app')
    expect(result[0].changeFrequency).toBe('weekly')
    expect(result[0].priority).toBe(1)
    expect(result[0].lastModified).toBeInstanceOf(Date)
  })
})
