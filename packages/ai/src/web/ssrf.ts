import { promises as dns } from 'dns'
import ipaddr from 'ipaddr.js'

type LookupAddress = {
  address: string
  family: number
}

export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<LookupAddress[]>

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])
const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal']
const BLOCKED_IP_RANGES = new Set([
  'private',
  'loopback',
  'linkLocal',
  'uniqueLocal',
  'reserved',
  'unspecified',
  'carrierGradeNat',
  'broadcast',
])
const METADATA_IP = '169.254.169.254'

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true
  }

  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function isPrivateIp(ip: string): boolean {
  const normalizedIp = ip.replace(/^\[(.*)\]$/, '$1')

  if (normalizedIp === METADATA_IP) {
    return true
  }

  try {
    const parsed = ipaddr.parse(normalizedIp)
    const normalized = parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed

    if (normalized.toString() === METADATA_IP) {
      return true
    }

    return BLOCKED_IP_RANGES.has(normalized.range())
  } catch {
    return true
  }
}

export async function assertPublicUrl(
  rawUrl: string,
  lookup: LookupFn = dns.lookup,
): Promise<void> {
  const url = new URL(rawUrl)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked non-public URL: unsupported protocol ${url.protocol}`)
  }

  const hostname = url.hostname.toLowerCase()
  const normalizedHostname = hostname.replace(/^\[(.*)\]$/, '$1')

  if (isBlockedHostname(normalizedHostname)) {
    throw new Error(`Blocked non-public URL: blocked hostname ${normalizedHostname}`)
  }

  if (ipaddr.isValid(normalizedHostname)) {
    if (isPrivateIp(normalizedHostname)) {
      throw new Error(`Blocked non-public URL: private IP ${normalizedHostname}`)
    }
    return
  }

  const addresses = await lookup(normalizedHostname, { all: true })
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error(`Blocked non-public URL: hostname resolves to private IP ${normalizedHostname}`)
  }
}
