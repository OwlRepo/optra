/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { resolveTourTheme } from './tour-theme'

const FALLBACK_OVERLAY = 'oklch(0.238 0.03 264 / 0.4)'
const FALLBACK_RING = 'oklch(0.5 0.09 184 / 0.35)'

describe('resolveTourTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.documentElement.classList.remove('dark')
  })

  it('error: missing tokens fall back to the documented oklch values', () => {
    const root = document.createElement('div')

    const theme = resolveTourTheme(root)

    expect(theme.overlayColor).toBe(FALLBACK_OVERLAY)
    expect(theme.spotlight.stroke).toBe(FALLBACK_RING)
    expect(theme.spotlight.strokeWidth).toBe(3)
  })

  it('edge: a blank token value falls back like a missing one', () => {
    const root = document.createElement('div')
    root.style.setProperty('--foreground', '   ')
    root.style.setProperty('--primary-strong', '')

    const theme = resolveTourTheme(root)

    expect(theme.overlayColor).toBe(FALLBACK_OVERLAY)
    expect(theme.spotlight.stroke).toBe(FALLBACK_RING)
  })

  it('edge: in dark mode the overlay is black at 60% so the scrim stays dark', () => {
    document.documentElement.classList.add('dark')
    document.documentElement.style.setProperty('--foreground', 'oklch(0.97 0.01 264)')

    const theme = resolveTourTheme()

    expect(theme.overlayColor).toBe('oklch(0 0 0 / 0.6)')
  })

  it('edge: in light mode the overlay stays foreground at 40%', () => {
    document.documentElement.style.setProperty('--foreground', 'oklch(0.238 0.03 264)')

    expect(resolveTourTheme().overlayColor).toBe('oklch(0.238 0.03 264 / 0.4)')
  })

  it('edge: backstop colours are never empty strings', () => {
    const theme = resolveTourTheme(document.createElement('div'))
    expect(theme.primaryColor).not.toBe('')
    expect(theme.textColor).not.toBe('')
    expect(theme.backgroundColor).not.toBe('')
  })

  it('regression: defaults to document.documentElement and re-reads on every call', () => {
    document.documentElement.style.setProperty('--foreground', 'oklch(0.9 0.01 264)')
    expect(resolveTourTheme().overlayColor).toBe('oklch(0.9 0.01 264 / 0.4)')

    document.documentElement.style.setProperty('--foreground', 'oklch(0.2 0.01 264)')
    expect(resolveTourTheme().overlayColor).toBe('oklch(0.2 0.01 264 / 0.4)')
  })

  it('happy: derives overlay and spotlight ring from the root tokens', () => {
    const root = document.createElement('div')
    root.style.setProperty('--foreground', 'oklch(0.238 0.03 264)')
    root.style.setProperty('--primary-strong', 'oklch(0.5 0.09 184)')
    document.body.appendChild(root)

    const theme = resolveTourTheme(root)

    expect(theme.overlayColor).toBe('oklch(0.238 0.03 264 / 0.4)')
    expect(theme.spotlight).toEqual({ stroke: 'oklch(0.5 0.09 184 / 0.35)', strokeWidth: 3 })
    root.remove()
  })
})
