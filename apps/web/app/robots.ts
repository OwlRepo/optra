import type { MetadataRoute } from 'next'

const WEB_URL = process.env.WEB_URL ?? 'https://mnemra.tyvera.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/chat', '/workspaces', '/invite', '/api'],
    },
    sitemap: `${WEB_URL}/sitemap.xml`,
  }
}
