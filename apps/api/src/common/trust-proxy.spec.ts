import { trustProxySetting } from './trust-proxy'

describe('trustProxySetting', () => {
  const original = process.env.TRUST_PROXY

  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = original
  })

  it.each(['true', 'yes', '0', '-1', '1.5', 'loopback'])(
    'error: refuses %p - only a positive hop count is safe',
    (value) => {
      process.env.TRUST_PROXY = value
      expect(() => trustProxySetting()).toThrow('TRUST_PROXY must be a positive hop count')
    },
  )

  it('edge: is off when TRUST_PROXY is unset or empty', () => {
    delete process.env.TRUST_PROXY
    expect(trustProxySetting()).toBe(false)
    process.env.TRUST_PROXY = ''
    expect(trustProxySetting()).toBe(false)
  })

  it('happy: returns the hop count', () => {
    process.env.TRUST_PROXY = '1'
    expect(trustProxySetting()).toBe(1)
  })
})
