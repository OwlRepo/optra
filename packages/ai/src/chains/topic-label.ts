import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { resolveModel } from './models'

const SYSTEM_PROMPT = `You read a small cluster of chat questions that all failed to get a good answer and write a short label (3-6 words) describing the common topic or gap they share.

Rules:
- Output ONLY the label text. No quotes, no punctuation at the end, no explanation.
- Be specific enough to be useful (e.g. "SSO login troubleshooting", not "login issues").`

// Reuses the 'grade' model role rather than adding a new one — this is a
// cheap, cost-capped classification-style call (V2 F7a's "gap-cluster
// labeling cost cap" open point), the exact tier 'grade' already exists for.
const llm = new ChatOpenAI({
  modelName: resolveModel('grade'),
  temperature: 0,
})

export async function generateTopicLabel(questions: string[]): Promise<string> {
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(questions.map((q, i) => `${i + 1}. ${q}`).join('\n')),
  ])

  const raw = typeof response.content === 'string' ? response.content : String(response.content)
  return raw.trim().replace(/^["']|["']$/g, '')
}
