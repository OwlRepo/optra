import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FaqSourceTicket } from './faq-draft'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

const TICKETS: FaqSourceTicket[] = [
  { title: 'Cannot reset password', issueSummary: 'Reset email never arrives', nextAction: 'Check spam folder, resend' },
  { title: 'Password reset broken', issueSummary: 'Link expired instantly', nextAction: 'Regenerate link' },
]

describe('generateFaqDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses a valid JSON response into a question/answer pair', async () => {
    invokeMock.mockResolvedValue({
      content: '```json\n{"question":"Why can\'t I reset my password?","answer":"Check spam, or request a new link."}\n```',
    })

    const { generateFaqDraft } = await import('./faq-draft')
    const result = await generateFaqDraft(TICKETS)

    expect(result).toEqual({
      question: "Why can't I reset my password?",
      answer: 'Check spam, or request a new link.',
    })
  })

  it('includes each ticket title/summary/resolution in the prompt, never raw transcript fields', async () => {
    invokeMock.mockResolvedValue({ content: '{"question":"q","answer":"a"}' })

    const { generateFaqDraft } = await import('./faq-draft')
    await generateFaqDraft(TICKETS)

    const [, humanMessage] = invokeMock.mock.calls[0][0]
    expect(humanMessage.content).toContain('Cannot reset password')
    expect(humanMessage.content).toContain('Reset email never arrives')
    expect(humanMessage.content).toContain('Check spam folder, resend')
  })

  it('throws FaqDraftParseError when the model returns malformed JSON', async () => {
    invokeMock.mockResolvedValue({ content: 'not json' })

    const { generateFaqDraft, FaqDraftParseError } = await import('./faq-draft')

    await expect(generateFaqDraft(TICKETS)).rejects.toThrow(FaqDraftParseError)
  })

  it('throws FaqDraftParseError when required fields are missing', async () => {
    invokeMock.mockResolvedValue({ content: '{"question":"q"}' })

    const { generateFaqDraft, FaqDraftParseError } = await import('./faq-draft')

    await expect(generateFaqDraft(TICKETS)).rejects.toThrow(FaqDraftParseError)
  })
})
