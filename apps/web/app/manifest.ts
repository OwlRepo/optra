import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mnemra',
    short_name: 'Mnemra',
    description: 'Turn support history into instant, sourced answers.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafd',
    theme_color: '#525edc',
    icons: [{ src: '/icon.png', sizes: '32x32', type: 'image/png' }],
  }
}
