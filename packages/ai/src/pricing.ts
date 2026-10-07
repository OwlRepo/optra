export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
}

// USD per 1,000,000 tokens, OpenAI standard tier, verified 2026-10-08 at
// https://developers.openai.com/api/docs/pricing. 1 USD = 1,000,000 micro-USD,
// so a per-million-token price is also the micro-USD price of one token.
// Recompute docs/business/unit-economics.md when this table changes.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4-turbo': { inputPerMTok: 10, outputPerMTok: 30 },
  'text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },
}

// The row with the highest output price: what an unknown model is billed as, so
// a typo or a new model can only ever over-count, never under-count.
export const FALLBACK_PRICE_MODEL = 'gpt-4-turbo'

const KEYS_LONGEST_FIRST = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length)
const warned = new Set<string>()

// A dated snapshot ("gpt-4o-2024-08-06") resolves to its base row. Longest key
// first, so "gpt-4o-mini-2024-07-18" is not caught by the shorter "gpt-4o".
export function priceFor(model: string | null | undefined): ModelPrice {
  const name = (model ?? '').trim().toLowerCase()
  const key = KEYS_LONGEST_FIRST.find((candidate) => name === candidate || name.startsWith(`${candidate}-`))
  if (key) return MODEL_PRICES[key]
  if (!warned.has(name)) {
    warned.add(name)
    console.warn(`[pricing] unknown model "${name || '(none)'}" priced as ${FALLBACK_PRICE_MODEL}`)
  }
  return MODEL_PRICES[FALLBACK_PRICE_MODEL]
}

function tokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Integer micro-USD, rounded up so a fraction of a micro-dollar is never dropped. */
export function costMicroUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model)
  return Math.ceil(tokens(inputTokens) * price.inputPerMTok + tokens(outputTokens) * price.outputPerMTok)
}
