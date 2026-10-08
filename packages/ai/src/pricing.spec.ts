import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_PRICE_MODEL, MODEL_PRICES, costMicroUsd, priceFor } from './pricing'

describe('pricing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('error: an unknown model is priced at the most expensive row and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const first = priceFor('totally-new-model-x1')
    const second = priceFor('totally-new-model-x1')

    expect(first).toEqual(MODEL_PRICES['gpt-4-turbo'])
    expect(second).toEqual(MODEL_PRICES['gpt-4-turbo'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('totally-new-model-x1')
  })

  it('error: an empty or undefined model name is priced at the most expensive row', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(priceFor(undefined)).toEqual(MODEL_PRICES[FALLBACK_PRICE_MODEL])
    expect(priceFor(null)).toEqual(MODEL_PRICES[FALLBACK_PRICE_MODEL])
    expect(priceFor('')).toEqual(MODEL_PRICES[FALLBACK_PRICE_MODEL])
    expect(priceFor('   ')).toEqual(MODEL_PRICES[FALLBACK_PRICE_MODEL])
  })

  it('error: negative, NaN and Infinity token counts never produce a negative or non-finite cost', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const cost = costMicroUsd('gpt-4o', bad, bad)
      expect(Number.isFinite(cost)).toBe(true)
      expect(cost).toBeGreaterThanOrEqual(0)
    }
    // A bad input side contributes nothing; the good side is still priced.
    expect(costMicroUsd('gpt-4o', Number.NaN, 100)).toBe(1000)
    expect(costMicroUsd('gpt-4o', -10, 100)).toBe(1000)
  })

  it('edge: a dated snapshot (gpt-4o-2024-08-06) resolves to gpt-4o', () => {
    expect(priceFor('gpt-4o-2024-08-06')).toEqual(MODEL_PRICES['gpt-4o'])
    expect(priceFor('gpt-4-turbo-2024-04-09')).toEqual(MODEL_PRICES['gpt-4-turbo'])
  })

  it('edge: gpt-4o-mini and its snapshots are not caught by the gpt-4o prefix', () => {
    expect(priceFor('gpt-4o-mini')).toEqual(MODEL_PRICES['gpt-4o-mini'])
    expect(priceFor('gpt-4o-mini-2024-07-18')).toEqual(MODEL_PRICES['gpt-4o-mini'])
    expect(priceFor('gpt-4o-mini')).not.toEqual(MODEL_PRICES['gpt-4o'])
  })

  it('edge: text-embedding-3-small output tokens cost nothing and input costs 0.02 per million', () => {
    expect(costMicroUsd('text-embedding-3-small', 0, 1_000_000)).toBe(0)
    expect(costMicroUsd('text-embedding-3-small', 1_000_000, 0)).toBe(20_000)
  })

  it('edge: the most expensive output row is gpt-4-turbo at 30 per million', () => {
    const maxOutput = Math.max(...Object.values(MODEL_PRICES).map((price) => price.outputPerMTok))
    expect(maxOutput).toBe(30)
    expect(MODEL_PRICES[FALLBACK_PRICE_MODEL].outputPerMTok).toBe(30)
    expect(FALLBACK_PRICE_MODEL).toBe('gpt-4-turbo')
  })

  it('edge: a fractional micro-dollar rounds up to the next integer', () => {
    // 1 input token of gpt-4o-mini = 0.15 micro-USD.
    expect(costMicroUsd('gpt-4o-mini', 1, 0)).toBe(1)
    // 1 in (0.15) + 1 out (0.6) = 0.75 -> 1.
    expect(costMicroUsd('gpt-4o-mini', 1, 1)).toBe(1)
    // 7 in (1.05) -> 2.
    expect(costMicroUsd('gpt-4o-mini', 7, 0)).toBe(2)
    expect(Number.isInteger(costMicroUsd('gpt-4o', 3, 3))).toBe(true)
  })

  it('regression: the table holds exactly gpt-4o 2.50/10, gpt-4o-mini 0.15/0.60, gpt-4-turbo 10/30 and text-embedding-3-small 0.02/0', () => {
    expect(MODEL_PRICES).toEqual({
      'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
      'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
      'gpt-4-turbo': { inputPerMTok: 10, outputPerMTok: 30 },
      'text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },
    })
  })

  it('regression: 1,000,000 input plus 1,000,000 output gpt-4o tokens cost 12,500,000 micro-USD', () => {
    expect(costMicroUsd('gpt-4o', 1_000_000, 1_000_000)).toBe(12_500_000)
  })

  it('happy: gpt-4o with 1,000 input and 500 output tokens costs 7,500 micro-USD', () => {
    expect(costMicroUsd('gpt-4o', 1000, 500)).toBe(7500)
  })
})
