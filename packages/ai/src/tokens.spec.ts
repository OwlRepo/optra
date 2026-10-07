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

describe('TokenMeter pricing (S4 metering)', () => {
  it('error: a response with no usage records nothing and costs zero', () => {
    const meter = new TokenMeter()
    meter.record({ content: 'no usage' }, 'gpt-4o')
    meter.record(null, 'gpt-4o')
    meter.record(undefined)

    expect(meter.total).toBe(0)
    expect(meter.inputTokens).toBe(0)
    expect(meter.outputTokens).toBe(0)
    expect(meter.costMicroUsd).toBe(0)
  })

  it('error: usage counts that are NaN, negative or strings are ignored', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: Number.NaN, output_tokens: -4, total_tokens: '99' } }, 'gpt-4o')
    meter.record({ usage_metadata: { input_tokens: '10', output_tokens: '5' } }, 'gpt-4o')

    expect(meter.total).toBe(0)
    expect(meter.costMicroUsd).toBe(0)
    expect(meter.dominantModel).toBeNull()
  })

  it('edge: only total_tokens is present: it is counted and priced entirely as output', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { total_tokens: 1000 } }, 'gpt-4o')

    expect(meter.total).toBe(1000)
    expect(meter.inputTokens).toBe(0)
    expect(meter.outputTokens).toBe(1000)
    expect(meter.costMicroUsd).toBe(10_000)
  })

  it('edge: the model passed to record wins over response_metadata.model_name', () => {
    const meter = new TokenMeter()
    meter.record(
      { usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 }, response_metadata: { model_name: 'gpt-4-turbo' } },
      'gpt-4o',
    )

    expect(meter.dominantModel).toBe('gpt-4o')
    expect(meter.costMicroUsd).toBe(7500)
  })

  it('edge: response_metadata.model_name is used when no model is passed', () => {
    const meter = new TokenMeter()
    meter.record({
      usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
      response_metadata: { model_name: 'gpt-4o-mini' },
    })

    expect(meter.dominantModel).toBe('gpt-4o-mini')
    expect(meter.costMicroUsd).toBe(Math.ceil(1000 * 0.15 + 500 * 0.6))
  })

  it('edge: two models in one meter are priced separately and dominantModel is the costlier one', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }, 'gpt-4o')
    meter.record({ usage_metadata: { input_tokens: 100_000, output_tokens: 50_000, total_tokens: 150_000 } }, 'gpt-4o-mini')

    // 7,500 for gpt-4o; ceil(15,000 + 30,000) = 45,000 for gpt-4o-mini.
    expect(meter.costMicroUsd).toBe(7500 + 45_000)
    expect(meter.dominantModel).toBe('gpt-4o-mini')
    expect(meter.total).toBe(151_500)
  })

  it('edge: with nothing recorded dominantModel is null', () => {
    expect(new TokenMeter().dominantModel).toBeNull()
  })

  it('regression: record(response) with one argument still sums total_tokens as before', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: 30, output_tokens: 12, total_tokens: 42 } })
    meter.record({ usage_metadata: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } })

    expect(meter.total).toBe(50)
  })

  it('happy: inputTokens and outputTokens expose the recorded sums', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: 30, output_tokens: 12, total_tokens: 42 } }, 'gpt-4o')
    meter.record({ usage_metadata: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }, 'gpt-4o-mini')

    expect(meter.inputTokens).toBe(35)
    expect(meter.outputTokens).toBe(15)
  })

  it('happy: costMicroUsd for 1,000 input and 500 output gpt-4o tokens is 7,500', () => {
    const meter = new TokenMeter()
    meter.record({ usage_metadata: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }, 'gpt-4o')

    expect(meter.costMicroUsd).toBe(7500)
  })
})
