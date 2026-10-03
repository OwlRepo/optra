// Joyride paints its overlay and spotlight as SVG attributes, where `var()` does
// not resolve. So the tokens are read from computed style at each tour start and
// handed over as concrete colours; that is also why light and dark both match.
// The only literal colours in the tour are the oklch fallbacks below.
const FALLBACK_OVERLAY = 'oklch(0.238 0.03 264 / 0.4)'
const FALLBACK_RING = 'oklch(0.5 0.09 184 / 0.35)'
const FALLBACK_TEXT = 'oklch(0.238 0.03 264)'
const FALLBACK_PRIMARY = 'oklch(0.5 0.09 184)'
// In dark mode `--foreground` is near-white, so a tinted scrim would lighten the page.
const DARK_OVERLAY = 'oklch(0 0 0 / 0.6)'
const FALLBACK_BACKGROUND = 'oklch(1 0 0)'

export interface TourTheme {
  overlayColor: string
  spotlight: { stroke: string; strokeWidth: number }
  primaryColor: string
  textColor: string
  backgroundColor: string
}

function token(root: HTMLElement, name: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim()
}

function withAlpha(color: string, alpha: number): string {
  // oklch(L C H) -> oklch(L C H / alpha). Anything else (a hex override) mixes instead.
  if (/^oklch\([^/)]*\)$/.test(color)) return `${color.slice(0, -1)} / ${alpha})`
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

export function resolveTourTheme(root?: HTMLElement): TourTheme {
  const el = root ?? document.documentElement
  const foreground = token(el, '--foreground')
  const primary = token(el, '--primary-strong')
  const card = token(el, '--card')
  const dark = document.documentElement.classList.contains('dark')
  return {
    overlayColor: dark ? DARK_OVERLAY : foreground ? withAlpha(foreground, 0.4) : FALLBACK_OVERLAY,
    spotlight: { stroke: primary ? withAlpha(primary, 0.35) : FALLBACK_RING, strokeWidth: 3 },
    primaryColor: primary || FALLBACK_PRIMARY,
    textColor: foreground || FALLBACK_TEXT,
    backgroundColor: card || FALLBACK_BACKGROUND,
  }
}
