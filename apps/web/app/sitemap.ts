import type { MetadataRoute } from 'next'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: WEB_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
