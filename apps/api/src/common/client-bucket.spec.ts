import { clientBucket } from './client-bucket'

describe('clientBucket', () => {
  it('error: an unknown address is one shared bucket', () => {
    expect(clientBucket(undefined)).toBe('unknown')
    expect(clientBucket('')).toBe('unknown')
  })

  it('edge: an IPv4-mapped IPv6 address is the IPv4 it carries', () => {
    expect(clientBucket('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('edge: groups are normalised - case, leading zeros, ::, zone id, IPv4 tail - before bucketing', () => {
    expect(clientBucket('2001:DB8:0001:0002::1')).toBe('2001:db8:1:2::/64')
    expect(clientBucket('::1')).toBe('0:0:0:0::/64')
    expect(clientBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(clientBucket('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64')
  })

  it('edge: a different /64 is a different bucket', () => {
    expect(clientBucket('2001:db8:1:3::1')).not.toBe(clientBucket('2001:db8:1:2::1'))
  })

  it('happy: an IPv4 address is its own bucket', () => {
    expect(clientBucket('203.0.113.7')).toBe('203.0.113.7')
  })

  it('happy: every IPv6 address in one /64 shares a bucket', () => {
    expect(clientBucket('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64')
    expect(clientBucket('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64')
  })
})
