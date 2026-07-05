import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { resolveModel } from './models'
import { boundHistory, historyCondenseEnabled, toMessages, type HistoryTurn } from './history'

const CONDENSE_SYSTEM_PROMPT = `Given the conversation history and a follow-up question, rewrite the follow-up
into a standalone question that contains all context needed to understand it without the history.

Rules:
- Resolve pronouns and references ("it", "that", "those", "my last question") into their explicit referents from the history.
- Preserve the user's actual intent and every specific detail (names, error messages, product terms) exactly.
- If the follow-up is already standalone and self-contained, return it unchanged.
- Do not answer the question. Only rewrite it.
- Output ONLY the standalone question text. No preamble, no quotes, no explanation.`

const llm = new ChatOpenAI({
  modelName: resolveModel('condense'),
  temperature: 0,
})

export async function condenseQuestion(question: string, history: HistoryTurn[]): Promise<string> {
  if (history.length === 0 || !historyCondenseEnabled()) {
    return question
  }

  const response = await llm.invoke([
    new SystemMessage(CONDENSE_SYSTEM_PROMPT),
    ...toMessages(boundHistory(history)),
    new HumanMessage(`Follow-up question: ${question}\nStandalone question:`),
  ])

  const text = extractText(response.content)
  return text.length > 0 ? text : question
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
