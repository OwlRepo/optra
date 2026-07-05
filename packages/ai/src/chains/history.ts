import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { countTokens } from '../tokens'

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MAX_MESSAGES = 12
const DEFAULT_TOKEN_BUDGET = 600

export function historyMaxMessages(): number {
  const raw = process.env.HISTORY_MAX_MESSAGES
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MESSAGES
}

export function historyTokenBudget(): number {
  const raw = process.env.HISTORY_TOKEN_BUDGET
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_BUDGET
}

export function historyCondenseEnabled(): boolean {
  return process.env.HISTORY_CONDENSE_ENABLED !== 'false'
}

export function historyInAnswerEnabled(): boolean {
  return process.env.HISTORY_IN_ANSWER_ENABLED !== 'false'
}

// Keeps the most recent turns, trimming from the oldest end first so the
// newest context always survives intact within the token budget.
export function boundHistory(turns: HistoryTurn[], budget = historyTokenBudget()): HistoryTurn[] {
  const kept: HistoryTurn[] = []
  let used = 0

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    const tokens = countTokens(turn.content)
    if (used + tokens > budget) break
    kept.unshift(turn)
    used += tokens
  }

  return kept
}

export function toMessages(history: HistoryTurn[]): (HumanMessage | AIMessage)[] {
  return history.map((turn) =>
    turn.role === 'user' ? new HumanMessage(turn.content) : new AIMessage(turn.content),
  )
}
