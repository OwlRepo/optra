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

  it('records the provider-reported token usage on the meter', async () => {
    invokeMock.mockResolvedValue({ content: 'label', usage_metadata: { input_tokens: 30, output_tokens: 12, total_tokens: 42 } })

    const { generateTopicLabel } = await import('./topic-label')
    const { TokenMeter } = await import('../tokens')
    const meter = new TokenMeter()
    await generateTopicLabel(['question one'], { meter })

    expect(meter.total).toBe(42)
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
