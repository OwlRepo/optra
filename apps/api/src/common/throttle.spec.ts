import { defaultThrottleLimit } from './throttle'

describe('defaultThrottleLimit', () => {
  const original = process.env.THROTTLE_DEFAULT_LIMIT

  afterEach(() => {
    if (original === undefined) delete process.env.THROTTLE_DEFAULT_LIMIT
    else process.env.THROTTLE_DEFAULT_LIMIT = original
  })

  it('defaults to 60 requests per window', () => {
    delete process.env.THROTTLE_DEFAULT_LIMIT
    expect(defaultThrottleLimit()).toBe(60)
  })

  it('reads THROTTLE_DEFAULT_LIMIT', () => {
    process.env.THROTTLE_DEFAULT_LIMIT = '100000'
    expect(defaultThrottleLimit()).toBe(100000)
  })

  it.each(['', 'abc', '0', '-5', '1.5'])('ignores %p and keeps the default', (value) => {
    process.env.THROTTLE_DEFAULT_LIMIT = value
    expect(defaultThrottleLimit()).toBe(60)
  })
})
