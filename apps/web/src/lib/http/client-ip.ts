// The visitor's address, for the API's per-visitor rate limits.
//
// Chain of custody: Caddy (host, v2.11) replaces any client-sent
// X-Forwarded-For with the peer address it actually saw; Next only fills the
// header when absent (never appends); this helper forwards exactly one value,
// the rightmost - the entry our own proxy wrote - and only if it is an IP. The
// API trusts it from one hop (TRUST_PROXY=1). Regex, not node:net, because
// middleware.ts runs on the edge runtime.

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6 = /^(?=.*:)[0-9a-f:.]{2,45}$/i

export function clientIpHeaders(headers: Headers): Record<string, string> {
  const chain = headers.get('x-forwarded-for')
  if (!chain) return {}
  const ip = chain.split(',').pop()!.trim()
  return IPV4.test(ip) || IPV6.test(ip) ? { 'X-Forwarded-For': ip } : {}
}
