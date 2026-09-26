const DEFAULT_LIMIT = 60

/**
 * Requests per minute for the global throttler. 60 unless THROTTLE_DEFAULT_LIMIT
 * is a positive integer.
 *
 * Exists for the browser e2e suite, not for production: every request reaches
 * the API from the web container's IP, so a whole Playwright run shares one
 * bucket and trips 429s that have nothing to do with the behaviour under test.
 * The per-route auth limits (`@Throttle` in auth.controller.ts) are
 * deliberately not configurable here.
 *
 * Anything that is not a positive integer keeps the default rather than
 * failing open — a typo must never turn rate limiting off.
 */
export function defaultThrottleLimit(): number {
  const raw = process.env.THROTTLE_DEFAULT_LIMIT
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_LIMIT
  const value = Number(raw)
  return value > 0 ? value : DEFAULT_LIMIT
}
