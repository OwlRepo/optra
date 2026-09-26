import { describe, expect, it } from 'vitest'
import { clientIpHeaders } from './client-ip'

const headersWith = (value?: string) => new Headers(value === undefined ? {} : { 'x-forwarded-for': value })

describe('clientIpHeaders', () => {
  it('error: forwards nothing when the value is not an IP address', () => {
    expect(clientIpHeaders(headersWith('not-an-ip'))).toEqual({})
    expect(clientIpHeaders(headersWith('999.1.1.1'))).toEqual({})
  })

  it('edge: forwards nothing when the request carries no X-Forwarded-For', () => {
    expect(clientIpHeaders(headersWith())).toEqual({})
    expect(clientIpHeaders(headersWith(''))).toEqual({})
  })

  it('edge: takes the rightmost entry - the one our own proxy wrote', () => {
    expect(clientIpHeaders(headersWith('6.6.6.6, 203.0.113.7'))).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('happy: forwards a single IPv4 address', () => {
    expect(clientIpHeaders(headersWith('203.0.113.7'))).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('happy: forwards an IPv6 address', () => {
    expect(clientIpHeaders(headersWith('2001:db8::1'))).toEqual({ 'X-Forwarded-For': '2001:db8::1' })
  })
})
