/**
 * Express `trust proxy` for the API: how many hops in front of it may set
 * X-Forwarded-For. Off unless TRUST_PROXY is a positive hop count.
 *
 * In production the only hop is the web app's BFF, which forwards the one
 * address Caddy wrote (apps/web/src/lib/http/client-ip.ts). `true` - trust
 * every hop - would let any client pick its own address and walk around
 * every rate limit, so anything but a positive integer refuses to boot
 * rather than falling back.
 */
export function trustProxySetting(): number | false {
  const raw = process.env.TRUST_PROXY
  if (raw === undefined || raw === '') return false
  if (/^[1-9]\d*$/.test(raw)) return Number(raw)
  throw new Error(`TRUST_PROXY must be a positive hop count (e.g. 1), got "${raw}"`)
}
