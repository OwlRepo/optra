import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryTurn } from './history'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

describe('condenseQuestion', () => {
  const env = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...env }
    delete process.env.HISTORY_CONDENSE_ENABLED
    delete process.env.HISTORY_TOKEN_BUDGET
  })

  afterEach(() => {
    process.env = env
  })

  it('skips the LLM call and returns the question unchanged when history is empty', async () => {
    const { condenseQuestion } = await import('./condense')
    const result = await condenseQuestion('What is our refund policy?', [])

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toBe('What is our refund policy?')
  })

  it('skips the LLM call and returns the question unchanged when HISTORY_CONDENSE_ENABLED=false, even with history', async () => {
    process.env.HISTORY_CONDENSE_ENABLED = 'false'
    const history: HistoryTurn[] = [
      { role: 'user', content: 'What is our refund policy?' },
      { role: 'assistant', content: 'Refunds are available within 30 days.' },
    ]

    const { condenseQuestion } = await import('./condense')
    const result = await condenseQuestion('How do I request one?', history)

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toBe('How do I request one?')
  })

  it('condenses a follow-up into a standalone question when history is present', async () => {
    const history: HistoryTurn[] = [
      { role: 'user', content: 'What is our refund policy?' },
      { role: 'assistant', content: 'Refunds are available within 30 days of purchase.' },
    ]
    invokeMock.mockResolvedValue({
      content: 'How do I request a refund within the 30-day window?',
    })

    const { condenseQuestion } = await import('./condense')
    const result = await condenseQuestion('How do I request one?', history)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const messages = invokeMock.mock.calls[0][0]
    const serialized = messages.map((m: { content: string }) => m.content).join('\n')
    expect(serialized).toContain('What is our refund policy?')
    expect(serialized).toContain('Refunds are available within 30 days of purchase.')
    expect(serialized).toContain('How do I request one?')
    expect(result).toBe('How do I request a refund within the 30-day window?')
  })

  it('falls back to the original question when the model returns empty content', async () => {
    const history: HistoryTurn[] = [{ role: 'user', content: 'prior turn' }]
    invokeMock.mockResolvedValue({ content: '   ' })

    const { condenseQuestion } = await import('./condense')
    const result = await condenseQuestion('follow-up question', history)

    expect(result).toBe('follow-up question')
  })

  it('bounds history input before building the prompt, dropping content outside the token budget', async () => {
    process.env.HISTORY_TOKEN_BUDGET = '20'
    const history: HistoryTurn[] = [
      { role: 'user', content: 'STALE_OLD_TOPIC '.repeat(50) },
      { role: 'assistant', content: 'STALE_OLD_REPLY '.repeat(50) },
      { role: 'user', content: 'RECENT_TOPIC question' },
      { role: 'assistant', content: 'RECENT_TOPIC answer' },
    ]
    invokeMock.mockResolvedValue({ content: 'standalone question' })

    const { condenseQuestion } = await import('./condense')
    await condenseQuestion('follow-up', history)

    const messages = invokeMock.mock.calls[0][0]
    const serialized = messages.map((m: { content: string }) => m.content).join('\n')
    expect(serialized).toContain('RECENT_TOPIC')
    expect(serialized).not.toContain('STALE_OLD_TOPIC')
    expect(serialized).not.toContain('STALE_OLD_REPLY')
  })
})
