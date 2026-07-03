import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerQuestionWithGraph } from './graph'

const {
  similaritySearchMock,
  selectMock,
  fromMock,
  whereMock,
  streamMock,
  invokeMock,
} = vi.hoisted(() => ({
  similaritySearchMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  streamMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('../vectorstore', () => ({
  similaritySearch: similaritySearchMock,
  similaritySearchWithTicketSlot: similaritySearchMock,
}))

vi.mock('@repo/db', () => ({
  db: {
    select: selectMock,
  },
  documents: {
    id: 'id',
    title: 'title',
    sourceUrl: 'sourceUrl',
  },
  tickets: {
    id: 'id',
    title: 'title',
  },
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    stream = streamMock
    invoke = invokeMock
  },
}))

describe('answerQuestionWithGraph', () => {
  const env = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...env,
      RETRIEVAL_SCORE_THRESHOLD: '0.78',
      MAX_QUERY_REWRITES: '2',
      SELF_GRADE_ENABLED: 'false',
    }

    selectMock.mockReturnValue({ from: fromMock })
    fromMock.mockReturnValue({ where: whereMock })
    whereMock.mockResolvedValue([
      { id: 'doc-1', title: 'Doc One', sourceUrl: 'https://example.com/doc' },
    ])
  })

  afterEach(() => {
    process.env = env
  })

  it('high score goes straight to generate with one stream call and no rewrite', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Grounded context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.isFallback).toBe(false)
    expect(tokens).toEqual(['answer'])
    expect(similaritySearchMock).toHaveBeenCalledTimes(1)
    expect(streamMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('low score rewrites once, retrieves again, then generates', async () => {
    similaritySearchMock
      .mockResolvedValueOnce([
        {
          id: 'chunk-1',
          content: 'Weak context.',
          metadata: { documentId: 'doc-1' },
          score: 0.3,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'chunk-2',
          content: 'Better context.',
          metadata: { documentId: 'doc-1' },
          score: 0.88,
        },
      ])
    invokeMock.mockResolvedValue({ content: 'rewritten question' })
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'better answer' }
      })(),
    )

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['better answer'])
    expect(similaritySearchMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(streamMock).toHaveBeenCalledTimes(1)
  })

  it('falls back after max rewrites when retrieval stays low', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Weak context.',
        metadata: { documentId: 'doc-1' },
        score: 0.2,
      },
    ])
    invokeMock.mockResolvedValue({ content: 'rewritten question' })

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.isFallback).toBe(true)
    expect(tokens).toEqual([
      "I don't have enough information to answer that. Consider escalating to a human.",
    ])
    expect(result.sources).toEqual([])
    expect(streamMock).not.toHaveBeenCalled()
  })

  it('self-grade can trigger one regenerate pass', async () => {
    process.env.SELF_GRADE_ENABLED = 'true'
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Grounded context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: 'first answer' }
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: 'regenerated answer' }
        })(),
      )
    invokeMock.mockResolvedValueOnce({ content: 'no' })

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['regenerated answer'])
    expect(streamMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('generates from the original question after a retrieval rewrite', async () => {
    process.env.SELF_GRADE_ENABLED = 'false'
    similaritySearchMock
      .mockResolvedValueOnce([
        { id: 'c1', content: 'weak', metadata: { documentId: 'doc-1' }, score: 0.3 },
      ])
      .mockResolvedValueOnce([
        { id: 'c2', content: 'better', metadata: { documentId: 'doc-1' }, score: 0.9 },
      ])
    invokeMock.mockResolvedValue({ content: 'rewritten retrieval query' })
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const result = await answerQuestionWithGraph('ORIGINAL user question', 'ws-1')
    for await (const _token of result.stream) {
      // drain
    }

    // Retrieval used the rewritten query on the second pass (re-embedded: no
    // precomputed vector after a rewrite).
    expect(similaritySearchMock).toHaveBeenNthCalledWith(
      2,
      'rewritten retrieval query',
      'ws-1',
      5,
      undefined,
      undefined,
    )
    // Generation used the ORIGINAL user question, not the rewritten retrieval query.
    const generateMessages = streamMock.mock.calls[0][0]
    const humanMessage = generateMessages[1]
    expect(humanMessage.content).toContain('ORIGINAL user question')
    expect(humanMessage.content).not.toContain('rewritten retrieval query')
  })

  it('confident path streams generation as multiple token chunks', async () => {
    process.env.SELF_GRADE_ENABLED = 'false'
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Grounded context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'Hello ' }
        yield { content: 'world' }
      })(),
    )

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['Hello ', 'world'])
    expect(streamMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('self-grade skips grading when top score >= SELF_GRADE_MIN_SCORE', async () => {
    process.env.SELF_GRADE_ENABLED = 'true'
    process.env.SELF_GRADE_MIN_SCORE = '0.85'
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Grounded context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['answer'])
    expect(invokeMock).not.toHaveBeenCalled()
    expect(streamMock).toHaveBeenCalledTimes(1)
  })

  it('self-grade still grades when top score < SELF_GRADE_MIN_SCORE', async () => {
    process.env.SELF_GRADE_ENABLED = 'true'
    process.env.SELF_GRADE_MIN_SCORE = '0.95'
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Grounded context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: 'first answer' }
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: 'regenerated answer' }
        })(),
      )
    invokeMock.mockResolvedValueOnce({ content: 'no' })

    const result = await answerQuestionWithGraph('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['regenerated answer'])
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(streamMock).toHaveBeenCalledTimes(2)
  })

  it('returns ticket citations from graph retrieval path', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Ticket context.',
        metadata: { ticketId: 'ticket-1' },
        score: 0.91,
      },
    ])
    whereMock.mockResolvedValueOnce([{ id: 'ticket-1', title: 'Ticket One' }])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const result = await answerQuestionWithGraph('question', 'ws-1')

    expect(result.sources).toEqual([
      {
        sourceType: 'ticket',
        ticketId: 'ticket-1',
        title: 'Ticket One',
        score: 0.91,
        snippet: 'Ticket context.',
      },
    ])
  })
})
