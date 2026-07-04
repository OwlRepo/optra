import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => {
  const fontLoader = () => ({ variable: '', className: '' })
  return { Outfit: fontLoader, DM_Sans: fontLoader, JetBrains_Mono: fontLoader }
})
vi.mock('@repo/ui/globals.css', () => ({}))
vi.mock('@repo/ui', () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => children }))

const { metadata } = await import('./layout')

describe('root layout metadata', () => {
  it('resolves metadataBase against the real deployed domain, not the retired mnemra.com', () => {
    expect(metadata.metadataBase?.toString()).toBe('https://mnemra.tyvera.app/')
  })

  it('describes the product using the real hero value prop instead of generic boilerplate', () => {
    const realCopy = 'Search past tickets, docs, and Slack threads to get a sourced answer before you start typing a reply.'
    expect(metadata.description).toBe(realCopy)
    expect(metadata.openGraph?.description).toBe(realCopy)
    expect(metadata.twitter?.description).toBe(realCopy)
  })

  it('sets a canonical alternate for the homepage', () => {
    expect(metadata.alternates?.canonical).toBe('/')
  })
})
