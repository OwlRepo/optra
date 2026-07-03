import { countTokens } from '../tokens'

// A retrieved chunk, reduced to what the evidence pack needs.
export interface EvidenceChunk {
  content: string
  score: number
  metadata?: Record<string, unknown> | null
}

const SEP = '\n---\n'
const DEFAULT_BUDGET = 1500
// Small cushion so token-boundary merges never push a trimmed block over budget.
const TRIM_MARGIN = 2

export function contextTokenBudget(): number {
  const raw = process.env.RAG_CONTEXT_TOKEN_BUDGET
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET
}

function labelFor(chunk: EvidenceChunk): string {
  const meta = chunk.metadata ?? {}
  for (const key of ['sectionTitle', 'title', 'source'] as const) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  if (typeof meta.ticketId === 'string') return 'ticket'
  if (typeof meta.documentId === 'string') return 'document'
  return 'source'
}

// Largest prefix of `text` whose token count stays within `maxTokens`.
function trimToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return ''
  if (countTokens(text) <= maxTokens) return text

  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (countTokens(text.slice(0, mid)) <= maxTokens) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo).trimEnd()
}

// Compact, ranked evidence pack: one labelled block per source (title/kind + score
// + excerpt), highest score first, capped at a shared token budget. Replaces dumping
// every full chunk into the prompt.
export function buildEvidencePack(
  chunks: EvidenceChunk[],
  budget = contextTokenBudget(),
): string {
  if (chunks.length === 0) return ''

  const sorted = [...chunks].sort((a, b) => b.score - a.score)
  const blocks: string[] = []

  for (const chunk of sorted) {
    const header = `[${labelFor(chunk)} · score ${chunk.score.toFixed(2)}]`
    const fullBlock = `${header}\n${chunk.content}`
    const candidate = [...blocks, fullBlock].join(SEP)

    if (countTokens(candidate) <= budget) {
      blocks.push(fullBlock)
      continue
    }

    // Doesn't fit whole: trim this chunk's excerpt to the remaining budget, then stop.
    const prefixTokens = blocks.length > 0 ? countTokens(blocks.join(SEP) + SEP) : 0
    const headerTokens = countTokens(`${header}\n`)
    const remaining = budget - prefixTokens - headerTokens - TRIM_MARGIN
    const excerpt = trimToTokens(chunk.content, remaining)
    if (excerpt.length > 0) {
      blocks.push(`${header}\n${excerpt}`)
    }
    break
  }

  return blocks.join(SEP)
}
