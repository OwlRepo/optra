import { afterEach, describe, expect, it, vi } from 'vitest'
import { countTokens, TokenMeter } from './tokens'

const { freeMock, encodeMock, getEncodingMock } = vi.hoisted(() => {
  const freeMock = vi.fn()
  const encodeMock = vi.fn()
  const getEncodingMock = vi.fn(() => ({
    encode: encodeMock,
    free: freeMock,
  }))

  return { freeMock, encodeMock, getEncodingMock }
})

vi.mock('tiktoken', () => ({
  get_encoding: getEncodingMock,
}))

describe('countTokens', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('counts encoded tokens and frees encoder', () => {
    encodeMock.mockReturnValue([1, 2, 3, 4])

    expect(countTokens('hello world')).toBe(4)
    expect(getEncodingMock).toHaveBeenCalledWith('cl100k_base')
    expect(encodeMock).toHaveBeenCalledWith('hello world')
    expect(freeMock).toHaveBeenCalledTimes(1)
  })
})

describe('TokenMeter', () => {
  it('sums the provider-reported total_tokens across recorded responses', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: 30, output_tokens: 12, total_tokens: 42 } })
    meter.record({ usage_metadata: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } })

    expect(meter.total).toBe(50)
  })

  it('ignores responses that report no usable usage', () => {
    const meter = new TokenMeter()
    meter.record({ content: 'no usage here' })
    meter.record(null)
    meter.record({ usage_metadata: { total_tokens: Number.NaN } })

    expect(meter.total).toBe(0)
  })
})
