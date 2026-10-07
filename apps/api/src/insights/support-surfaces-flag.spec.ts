import { supportSurfacesEnabled } from './support-surfaces-flag'

describe('supportSurfacesEnabled', () => {
  const original = process.env.SUPPORT_SURFACES_ENABLED

  afterEach(() => {
    if (original === undefined) delete process.env.SUPPORT_SURFACES_ENABLED
    else process.env.SUPPORT_SURFACES_ENABLED = original
  })

  it('edge: is off when SUPPORT_SURFACES_ENABLED is unset', () => {
    delete process.env.SUPPORT_SURFACES_ENABLED
    expect(supportSurfacesEnabled()).toBe(false)
  })

  it('edge: is off for any value other than the exact string true', () => {
    for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
      process.env.SUPPORT_SURFACES_ENABLED = value
      expect(supportSurfacesEnabled()).toBe(false)
    }
  })

  it('regression: reads the env at call time, not at import time', () => {
    process.env.SUPPORT_SURFACES_ENABLED = 'true'
    expect(supportSurfacesEnabled()).toBe(true)
    process.env.SUPPORT_SURFACES_ENABLED = 'false'
    expect(supportSurfacesEnabled()).toBe(false)
  })

  it('happy: is on when SUPPORT_SURFACES_ENABLED is true', () => {
    process.env.SUPPORT_SURFACES_ENABLED = 'true'
    expect(supportSurfacesEnabled()).toBe(true)
  })
})
