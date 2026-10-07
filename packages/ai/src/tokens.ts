import { get_encoding } from 'tiktoken'
import { costMicroUsd } from './pricing'

interface UsageBearingResponse {
  usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  // @langchain/openai@0.2.11 does not set a model name on responses; read only as a fallback.
  response_metadata?: { model_name?: string; model?: string }
}

interface ModelUsage {
  input: number
  output: number
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// Accumulates the token usage the provider actually reports, per model, so the
// caller can both charge the Redis token budget (total) and price the spend in
// micro-USD for the billing ledger (costMicroUsd). @langchain/openai sets
// `usage_metadata` on every invoke() result and on the trailing stream chunk.
// The model name is passed by the call site (`llm.modelName`): the response
// does not carry it.
export class TokenMeter {
  private used = 0
  private readonly byModel = new Map<string, ModelUsage>()

  record(response: unknown, model?: string): void {
    const r = response as UsageBearingResponse | null | undefined
    const usage = r?.usage_metadata
    const input = positive(usage?.input_tokens)
    let output = positive(usage?.output_tokens)
    const total = positive(usage?.total_tokens) || input + output
    if (total === 0) return
    this.used += total
    // Only a total: price all of it at the output rate (the dearer side).
    if (input + output === 0) output = total
    const name = (model?.trim() || r?.response_metadata?.model_name || r?.response_metadata?.model || '').trim()
    const entry = this.byModel.get(name) ?? { input: 0, output: 0 }
    entry.input += input
    entry.output += output
    this.byModel.set(name, entry)
  }

  get total(): number {
    return this.used
  }

  get inputTokens(): number {
    let sum = 0
    for (const entry of this.byModel.values()) sum += entry.input
    return sum
  }

  get outputTokens(): number {
    let sum = 0
    for (const entry of this.byModel.values()) sum += entry.output
    return sum
  }

  /** Integer micro-USD across every model recorded (each priced by its own row). */
  get costMicroUsd(): number {
    let sum = 0
    for (const [name, entry] of this.byModel) sum += costMicroUsd(name, entry.input, entry.output)
    return sum
  }

  /** The model that cost the most, for the ledger's audit column; null when nothing was recorded. */
  get dominantModel(): string | null {
    let best: string | null = null
    let bestCost = -1
    for (const [name, entry] of this.byModel) {
      const cost = costMicroUsd(name, entry.input, entry.output)
      if (cost > bestCost) {
        best = name
        bestCost = cost
      }
    }
    return best && best.length > 0 ? best : null
  }
}

export function countTokens(text: string): number {
  const encoder = get_encoding('cl100k_base')

  try {
    return encoder.encode(text).length
  } finally {
    encoder.free()
  }
}
