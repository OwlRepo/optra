import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function pngDimensions(name: string) {
  const buf = readFileSync(join(__dirname, name))
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('static brand image assets (Next app/ file-convention icons)', () => {
  it('ships the source folded-page SVG mark used by web chrome', () => {
    const svgPath = join(__dirname, '../public/mnemra-mark.svg')
    expect(existsSync(svgPath)).toBe(true)

    const svg = readFileSync(svgPath, 'utf8')
    expect(svg).toContain('<title>Mnemra folded-page mark</title>')
    expect(svg).toContain('data-mark="mnemra-folded-page"')
  })

  it('ships a 32x32 favicon', () => {
    expect(pngDimensions('icon.png')).toEqual({ width: 32, height: 32 })
  })

  it('ships a real ICO favicon fallback', () => {
    const buf = readFileSync(join(__dirname, 'favicon.ico'))
    expect(buf.subarray(0, 4).toString('hex')).toBe('00000100')
  })

  it('ships a 180x180 apple touch icon', () => {
    expect(pngDimensions('apple-icon.png')).toEqual({ width: 180, height: 180 })
  })

  it('ships a 1200x630 share card image', () => {
    expect(pngDimensions('opengraph-image.png')).toEqual({ width: 1200, height: 630 })
  })
})
