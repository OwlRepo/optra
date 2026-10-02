import { describe, expect, it } from 'vitest'
import sitemap from './sitemap'

describe('sitemap', () => {
  it('edge: lists exactly four public URLs, no app or auth routes', () => {
    const urls = sitemap().map((entry) => entry.url)

    expect(urls).toHaveLength(4)
    expect(urls.some((url) => /workspaces|login|register|chat/.test(url))).toBe(false)
  })

  it('happy: lists the homepage on the real deployed domain', () => {
    const result = sitemap()
    expect(result[0].url).toBe('https://optra.example.com')
    expect(result[0].changeFrequency).toBe('weekly')
    expect(result[0].priority).toBe(1)
    expect(result[0].lastModified).toBeInstanceOf(Date)
  })

  it('happy: lists terms, privacy and refund monthly at priority 0.3', () => {
    const byUrl = new Map(sitemap().map((entry) => [entry.url, entry]))

    for (const path of ['terms', 'privacy', 'refund']) {
      const entry = byUrl.get(`https://optra.example.com/${path}`)
      expect(entry?.changeFrequency).toBe('monthly')
      expect(entry?.priority).toBe(0.3)
    }
  })
})
