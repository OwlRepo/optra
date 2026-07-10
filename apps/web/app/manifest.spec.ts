import { describe, expect, it } from 'vitest'
import manifest from './manifest'

describe('manifest', () => {
  it('identifies the app with real product copy and brand colors', () => {
    const result = manifest()
    expect(result.name).toBe('Optra')
    expect(result.short_name).toBe('Optra')
    expect(result.description).toBe('Vision-verified vendor sourcing and invoice matching.')
    expect(result.start_url).toBe('/')
    expect(result.theme_color).toBe('#0F8A7E')
    expect(result.background_color).toBe('#f8fafd')
  })

  it('references the static favicon asset', () => {
    const result = manifest()
    expect(result.icons).toEqual([
      { src: '/icon.png', sizes: '32x32', type: 'image/png' },
    ])
  })
})
