import { describe, expect, it, vi } from 'vitest'

const fontCalls = vi.hoisted(() => ({ dmSans: [] as unknown[] }))

vi.mock('next/font/google', () => {
  const fontLoader = () => ({ variable: '', className: '' })
  const dmSans = (options: unknown) => {
    fontCalls.dmSans.push(options)
    return fontLoader()
  }
  return { Outfit: fontLoader, DM_Sans: dmSans, JetBrains_Mono: fontLoader }
})
vi.mock('@repo/ui/globals.css', () => ({}))
vi.mock('@repo/ui', () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => children }))

const { metadata } = await import('./layout')

describe('root layout fonts', () => {
  // DM Sans' latin subset has no U+2192. The frames fall back to system-ui for
  // the arrow ("DM Sans", system-ui); next/font's automatic Arial fallback
  // would draw Arial's long arrow instead.
  it('regression: DM Sans falls back to system-ui, not the auto-generated Arial face', () => {
    expect(fontCalls.dmSans).toHaveLength(1)
    expect(fontCalls.dmSans[0]).toMatchObject({ adjustFontFallback: false, fallback: ['system-ui', 'sans-serif'] })
  })

  // The handoff loads DM Sans with its optical-size axis (opsz 9..40); without
  // it small text sets narrower and lines break in different places.
  it('regression: DM Sans loads the optical-size axis like the frames', () => {
    expect(fontCalls.dmSans[0]).toMatchObject({ axes: ['opsz'] })
  })
})

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
