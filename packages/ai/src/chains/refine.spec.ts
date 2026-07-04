import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

describe('refineMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the refined text on happy path', async () => {
    invokeMock.mockResolvedValue({
      content: 'Customer cannot reset password after SSO migration. What is the fix?',
    })

    const { refineMessage } = await import('./refine')
    const result = await refineMessage('uhh so like the customer cant reset their password after we did the sso thing, what do i do')

    expect(result).toBe('Customer cannot reset password after SSO migration. What is the fix?')
  })

  it('strips wrapping quotes the model sometimes adds', async () => {
    invokeMock.mockResolvedValue({
      content: '"What is our refund policy for annual plans?"',
    })

    const { refineMessage } = await import('./refine')
    const result = await refineMessage('whats the refund policy for annual plans again')

    expect(result).toBe('What is our refund policy for annual plans?')
  })

  it('joins array-shaped content parts', async () => {
    invokeMock.mockResolvedValue({
      content: [{ text: 'Refined question here.' }],
    })

    const { refineMessage } = await import('./refine')
    const result = await refineMessage('raw input')

    expect(result).toBe('Refined question here.')
  })

  it('throws RefineEmptyError when the model returns empty content', async () => {
    invokeMock.mockResolvedValue({ content: '' })

    const { refineMessage, RefineEmptyError } = await import('./refine')

    await expect(refineMessage('raw input')).rejects.toThrow(RefineEmptyError)
  })

  it('throws RefineRefusalError when the model refuses', async () => {
    invokeMock.mockResolvedValue({
      content: '',
      additional_kwargs: { refusal: 'I cannot help with that.' },
    })

    const { refineMessage, RefineRefusalError } = await import('./refine')

    await expect(refineMessage('raw input')).rejects.toThrow(RefineRefusalError)
  })
})
