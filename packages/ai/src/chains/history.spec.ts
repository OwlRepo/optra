import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import {
  boundHistory,
  historyCondenseEnabled,
  historyInAnswerEnabled,
  historyMaxMessages,
  historyTokenBudget,
  toMessages,
  type HistoryTurn,
} from './history'
import { countTokens } from '../tokens'

describe('history (#multi-turn chat helpers)', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.HISTORY_MAX_MESSAGES
    delete process.env.HISTORY_TOKEN_BUDGET
    delete process.env.HISTORY_CONDENSE_ENABLED
    delete process.env.HISTORY_IN_ANSWER_ENABLED
  })

  afterEach(() => {
    process.env = env
  })

  describe('historyMaxMessages', () => {
    it('defaults to 12', () => {
      expect(historyMaxMessages()).toBe(12)
    })

    it('reads HISTORY_MAX_MESSAGES from env', () => {
      process.env.HISTORY_MAX_MESSAGES = '4'
      expect(historyMaxMessages()).toBe(4)
    })

    it('ignores an invalid value and falls back to the default', () => {
      process.env.HISTORY_MAX_MESSAGES = 'not-a-number'
      expect(historyMaxMessages()).toBe(12)
    })
  })

  describe('historyTokenBudget', () => {
    it('defaults to 600', () => {
      expect(historyTokenBudget()).toBe(600)
    })

    it('reads HISTORY_TOKEN_BUDGET from env', () => {
      process.env.HISTORY_TOKEN_BUDGET = '100'
      expect(historyTokenBudget()).toBe(100)
    })
  })

  describe('historyCondenseEnabled / historyInAnswerEnabled', () => {
    it('default to true when unset', () => {
      expect(historyCondenseEnabled()).toBe(true)
      expect(historyInAnswerEnabled()).toBe(true)
    })

    it('honor an explicit false override', () => {
      process.env.HISTORY_CONDENSE_ENABLED = 'false'
      process.env.HISTORY_IN_ANSWER_ENABLED = 'false'
      expect(historyCondenseEnabled()).toBe(false)
      expect(historyInAnswerEnabled()).toBe(false)
    })

    it('treats any non-false value as enabled', () => {
      process.env.HISTORY_CONDENSE_ENABLED = 'true'
      expect(historyCondenseEnabled()).toBe(true)
    })
  })

  describe('boundHistory', () => {
    it('returns all turns unchanged when under budget', () => {
      const turns: HistoryTurn[] = [
        { role: 'user', content: 'What is our refund policy?' },
        { role: 'assistant', content: 'Refunds are available within 30 days.' },
      ]
      expect(boundHistory(turns, 1000)).toEqual(turns)
    })

    it('returns an empty array for empty input', () => {
      expect(boundHistory([], 1000)).toEqual([])
    })

    it('keeps the most recent turns and drops the oldest when over budget', () => {
      const turns: HistoryTurn[] = [
        { role: 'user', content: 'OLD '.repeat(50) },
        { role: 'assistant', content: 'OLD-REPLY '.repeat(50) },
        { role: 'user', content: 'RECENT question' },
        { role: 'assistant', content: 'RECENT answer' },
      ]
      const result = boundHistory(turns, 20)

      expect(result.some((t) => t.content.includes('RECENT'))).toBe(true)
      expect(result.some((t) => t.content.includes('OLD'))).toBe(false)
    })

    it('preserves chronological order of the surviving turns', () => {
      const turns: HistoryTurn[] = [
        { role: 'user', content: 'OLD '.repeat(50) },
        { role: 'user', content: 'first recent' },
        { role: 'assistant', content: 'second recent' },
      ]
      const result = boundHistory(turns, 20)

      expect(result.map((t) => t.content)).toEqual(['first recent', 'second recent'])
    })

    it('never returns turns whose combined tokens exceed the budget', () => {
      const turns: HistoryTurn[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as HistoryTurn['role'],
        content: `turn number ${i} `.repeat(20),
      }))
      const budget = 50
      const result = boundHistory(turns, budget)
      const totalTokens = result.reduce((sum, t) => sum + countTokens(t.content), 0)

      expect(totalTokens).toBeLessThanOrEqual(budget)
    })

    it('reads HISTORY_TOKEN_BUDGET from env by default', () => {
      process.env.HISTORY_TOKEN_BUDGET = '5'
      const turns: HistoryTurn[] = [{ role: 'user', content: 'word '.repeat(50) }]
      const result = boundHistory(turns)
      const totalTokens = result.reduce((sum, t) => sum + countTokens(t.content), 0)

      expect(totalTokens).toBeLessThanOrEqual(5)
    })
  })

  describe('toMessages', () => {
    it('maps user turns to HumanMessage and assistant turns to AIMessage, preserving order', () => {
      const turns: HistoryTurn[] = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ]
      const messages = toMessages(turns)

      expect(messages).toHaveLength(3)
      expect(messages[0]).toBeInstanceOf(HumanMessage)
      expect(messages[1]).toBeInstanceOf(AIMessage)
      expect(messages[2]).toBeInstanceOf(HumanMessage)
      expect(messages[0]?.content).toBe('first')
      expect(messages[1]?.content).toBe('second')
      expect(messages[2]?.content).toBe('third')
    })

    it('returns an empty array for empty history', () => {
      expect(toMessages([])).toEqual([])
    })
  })
})
