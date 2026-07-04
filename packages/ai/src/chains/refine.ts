import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { resolveModel } from './models'

// Caveman-style compression per docs.ai/../caveman skill "full" intensity:
// drop filler/hedging/articles where safe, prefer short direct phrasing, keep
// every technical term/error string/product name verbatim. The goal is a
// clean, retrieval-friendly question — not maximum compression, which would
// hurt vector-search recall.
const REFINE_SYSTEM_PROMPT = `You refine a support agent's rough chat prompt into a clear, on-point question for a workspace knowledge-base assistant.

Rules:
- Fix grammar and spelling.
- Remove filler words and hedging (just, really, basically, actually, kind of).
- Drop unnecessary articles and pleasantries; prefer short, direct phrasing.
- Keep every technical term, product name, error message, and specific detail exactly as given — never paraphrase or drop specifics.
- Do not answer the question. Only rewrite it.
- Output ONLY the refined question text. No preamble, no quotes, no explanation.`

const llm = new ChatOpenAI({
  modelName: resolveModel('refine'),
  temperature: 0.2,
  timeout: Number.parseInt(process.env.OPENAI_TIMEOUT_MS ?? '30000', 10),
})

export class RefineEmptyError extends Error {
  constructor(message = 'Model returned an empty refined message') {
    super(message)
    this.name = 'RefineEmptyError'
  }
}

export class RefineRefusalError extends Error {
  constructor(message = 'Model refused the refine request') {
    super(message)
    this.name = 'RefineRefusalError'
  }
}

export async function refineMessage(rawText: string): Promise<string> {
  const response = await llm.invoke([
    new SystemMessage(REFINE_SYSTEM_PROMPT),
    new HumanMessage(rawText),
  ])

  if (isRefusal(response)) {
    throw new RefineRefusalError()
  }

  const text = extractText(response.content)
  if (text.length === 0) {
    throw new RefineEmptyError()
  }

  return stripWrappingQuotes(text)
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text
        }
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

function stripWrappingQuotes(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).trim()
  }
  return text
}

function isRefusal(response: { additional_kwargs?: Record<string, unknown>; content: unknown }) {
  if (typeof response.additional_kwargs?.refusal === 'string' && response.additional_kwargs.refusal.length > 0) {
    return true
  }

  const text = extractText(response.content).toLowerCase()
  return text.startsWith("i can't") || text.startsWith('i cannot')
}
