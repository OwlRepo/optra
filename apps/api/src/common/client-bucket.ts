import { isIPv6 } from 'node:net'

// The throttler's tracker: which bucket a request counts against.
//
// An IPv4 address is its own bucket. IPv6 is bucketed per /64: one subscriber
// is routinely handed a whole /64, so per-address buckets would give a single
// host 2^64 of them. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is the
// IPv4 it carries.

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

export function clientBucket(ip: string | undefined): string {
  if (!ip) return 'unknown'
  const mapped = IPV4_MAPPED.exec(ip)
  if (mapped) return mapped[1]
  if (!isIPv6(ip)) return ip
  return `${hextets(ip).slice(0, 4).join(':')}::/64`
}

// The eight groups of an IPv6 address: zone id dropped, `::` expanded, leading
// zeros removed, lower-cased. An embedded IPv4 tail counts as two groups.
function hextets(ip: string): string[] {
  const address = ip.split('%')[0]
  const [head, tail] = address.includes('::') ? address.split('::') : [address, undefined]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const width = (groups: string[]) => groups.reduce((n, group) => n + (group.includes('.') ? 2 : 1), 0)
  const zeros = tail === undefined ? [] : Array<string>(8 - width(left) - width(right)).fill('0')
  return [...left, ...zeros, ...right].map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
}
