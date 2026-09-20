import { get_encoding } from 'tiktoken'

interface UsageBearingResponse {
  usage_metadata?: { total_tokens?: number }
}

// Accumulates the token usage the provider actually reports. @langchain/openai
// sets `usage_metadata` on every invoke() result (and on the trailing stream
// chunk), so a chain records each response it receives — including every
// retry attempt that got a response — and the caller charges the total to the
// workspace budget. countTokens() below stays a local estimate only.
export class TokenMeter {
  private used = 0

  record(response: unknown): void {
    const total = (response as UsageBearingResponse | null | undefined)?.usage_metadata?.total_tokens
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
      this.used += total
    }
  }

  get total(): number {
    return this.used
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
