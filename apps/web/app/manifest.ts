import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Optra',
    short_name: 'Optra',
    description: 'Vision-verified vendor sourcing and invoice matching.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafd',
    theme_color: '#0F8A7E',
    icons: [{ src: '/icon.png', sizes: '32x32', type: 'image/png' }],
  }
}
