import { describe, expect, it } from 'vitest'
import manifest from './manifest'

describe('manifest', () => {
  it('identifies the app with real product copy and brand colors', () => {
    const result = manifest()
    expect(result.name).toBe('Mnemra')
    expect(result.short_name).toBe('Mnemra')
    expect(result.description).toBe('Turn support history into instant, sourced answers.')
    expect(result.start_url).toBe('/')
    expect(result.theme_color).toBe('#525edc')
    expect(result.background_color).toBe('#f8fafd')
  })

  it('references the static favicon asset', () => {
    const result = manifest()
    expect(result.icons).toEqual([
      { src: '/icon.png', sizes: '32x32', type: 'image/png' },
    ])
  })
})
