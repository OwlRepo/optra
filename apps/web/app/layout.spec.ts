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
    expect(metadata.metadataBase?.toString()).toBe('https://optra.example.com/')
  })

  it('describes the product using the real hero value prop instead of generic boilerplate', () => {
    const realCopy = 'Match purchase orders against vendor catalogs and invoices, with vision-based product matching and automatic discrepancy flagging.'
    expect(metadata.description).toBe(realCopy)
    expect(metadata.openGraph?.description).toBe(realCopy)
    expect(metadata.twitter?.description).toBe(realCopy)
  })

  it('sets a canonical alternate for the homepage', () => {
    expect(metadata.alternates?.canonical).toBe('/')
  })
})
