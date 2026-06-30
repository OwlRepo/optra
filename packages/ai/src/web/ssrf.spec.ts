import { describe, expect, it, vi } from 'vitest'
import { assertPublicUrl, isBlockedHostname, isPrivateIp } from './ssrf'

describe('isBlockedHostname', () => {
  it('blocks internal hostnames', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('foo.local')).toBe(true)
    expect(isBlockedHostname('service.internal')).toBe(true)
    expect(isBlockedHostname('metadata.google.internal')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
  })
})

describe('isPrivateIp', () => {
  it('blocks private, loopback, link-local, metadata, reserved, and ipv4-mapped loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('169.254.169.254')).toBe(true)
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertPublicUrl', () => {
  it('rejects blocked internal targets', async () => {
    const lookup = vi.fn()

    await expect(assertPublicUrl('http://127.0.0.1', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('http://169.254.169.254', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('http://10.0.0.1', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('http://192.168.1.1', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('http://[::1]', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('http://localhost', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    await expect(assertPublicUrl('https://foo.local', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
  })

  it('rejects dns rebinding to private ip', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '10.0.0.7', family: 4 }])

    await expect(assertPublicUrl('https://public.example.com', lookup)).rejects.toThrow(
      'Blocked non-public URL',
    )
    expect(lookup).toHaveBeenCalledWith('public.example.com', { all: true })
  })

  it('accepts public hosts and ip literals', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])

    await expect(assertPublicUrl('https://example.com', lookup)).resolves.toBeUndefined()
    await expect(assertPublicUrl('https://8.8.8.8', lookup)).resolves.toBeUndefined()
  })
})
