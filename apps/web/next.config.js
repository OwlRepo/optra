/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/ui', '@repo/ai', '@repo/types'],
  experimental: {
    serverComponentsExternalPackages: ['langchain'],
  },
  output: 'standalone',
}

module.exports = nextConfig
