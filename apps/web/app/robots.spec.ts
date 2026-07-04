import { describe, expect, it } from 'vitest'
import robots from './robots'

describe('robots', () => {
  it('allows the marketing site but disallows authenticated app-shell routes', () => {
    const result = robots()
    expect(result.rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: ['/chat', '/workspaces', '/invite', '/api'],
    })
  })

  it('points crawlers at the sitemap on the real deployed domain', () => {
    const result = robots()
    expect(result.sitemap).toBe('https://mnemra.tyvera.app/sitemap.xml')
  })
})
