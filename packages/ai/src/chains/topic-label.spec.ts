import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

describe('generateTopicLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trims and strips surrounding quotes from the model response', async () => {
    invokeMock.mockResolvedValue({ content: '"SSO login troubleshooting"' })

    const { generateTopicLabel } = await import('./topic-label')
    const result = await generateTopicLabel(['why cant i log in with SSO', 'SSO login broken'])

    expect(result).toBe('SSO login troubleshooting')
  })

  it('includes every question in the prompt', async () => {
    invokeMock.mockResolvedValue({ content: 'label' })

    const { generateTopicLabel } = await import('./topic-label')
    await generateTopicLabel(['question one', 'question two'])

    const [, humanMessage] = invokeMock.mock.calls[0][0]
    expect(humanMessage.content).toContain('question one')
    expect(humanMessage.content).toContain('question two')
  })
})
