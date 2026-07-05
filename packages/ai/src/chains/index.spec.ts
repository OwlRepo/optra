import { describe, expect, it, vi, beforeEach } from 'vitest'

const similaritySearchMock = vi.fn()
const streamMock = vi.fn()
const selectMock = vi.fn()
const fromMock = vi.fn()
const whereMock = vi.fn()

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
    knowledgeBaseId: 'knowledgeBaseId',
  },
  tickets: {
    id: 'id',
    title: 'title',
  },
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    stream = streamMock
  },
}))

describe('answerQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LANGGRAPH_ENABLED
    selectMock.mockReturnValue({ from: fromMock })
    fromMock.mockReturnValue({ where: whereMock })
  })

  it('returns deduped sources and streamed answer tokens', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'First chunk content is long enough to become snippet for first source.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
      {
        id: 'chunk-2',
        content: 'Second chunk same doc should not create duplicate source row.',
        metadata: { documentId: 'doc-1' },
        score: 0.82,
      },
      {
        id: 'chunk-3',
        content: 'Third chunk another doc should create second source row.',
        metadata: { documentId: 'doc-2' },
        score: 0.88,
      },
    ])
    whereMock.mockResolvedValue([
      { id: 'doc-1', title: 'Doc One', sourceUrl: 'https://example.com/one', knowledgeBaseId: 'kb-1' },
      { id: 'doc-2', title: 'Doc Two', sourceUrl: null, knowledgeBaseId: 'kb-2' },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'hello ' }
        yield { content: 'world' }
      })(),
    )

    const { answerQuestion } = await import('./index')
    const result = await answerQuestion('question', 'ws-1')
    const tokens: string[] = []

    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.isFallback).toBe(false)
    expect(result.sources).toEqual([
      {
        sourceType: 'document',
        documentId: 'doc-1',
        knowledgeBaseId: 'kb-1',
        title: 'Doc One',
        sourceUrl: 'https://example.com/one',
        score: 0.91,
        snippet: 'First chunk content is long enough to become snippet for first source.',
      },
      {
        sourceType: 'document',
        documentId: 'doc-2',
        knowledgeBaseId: 'kb-2',
        title: 'Doc Two',
        sourceUrl: null,
        score: 0.88,
        snippet: 'Third chunk another doc should create second source row.',
      },
    ])
    expect(tokens.join('')).toBe('hello world')
  })

  it('uses hedged prompt copy while preserving hard no-info sentence', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Partial context.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
    ])
    whereMock.mockResolvedValue([
      { id: 'doc-1', title: 'Doc One', sourceUrl: 'https://example.com/one', knowledgeBaseId: 'kb-1' },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const { answerQuestion } = await import('./index')
    const result = await answerQuestion('question', 'ws-1')
    for await (const _token of result.stream) {
      // drain
    }

    const prompt = streamMock.mock.calls[0][0][0].content
    expect(prompt).toContain('If the context is only partially relevant')
    expect(prompt).toContain('point the user to the sources below')
    expect(prompt).toContain("\"I don't have enough information to answer that.\"")
  })

  it('returns mixed document and ticket citations, deduped by kind', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Document chunk content.',
        metadata: { documentId: 'doc-1' },
        score: 0.91,
      },
      {
        id: 'chunk-2',
        content: 'Ticket chunk better score.',
        metadata: { ticketId: 'ticket-1' },
        score: 0.89,
      },
      {
        id: 'chunk-3',
        content: 'Ticket chunk lower score duplicate.',
        metadata: { ticketId: 'ticket-1' },
        score: 0.4,
      },
    ])
    whereMock
      .mockResolvedValueOnce([{ id: 'doc-1', title: 'Doc One', sourceUrl: 'https://example.com/one', knowledgeBaseId: 'kb-1' }])
      .mockResolvedValueOnce([{ id: 'ticket-1', title: 'Ticket One' }])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'answer' }
      })(),
    )

    const { answerQuestion } = await import('./index')
    const result = await answerQuestion('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.sources).toEqual([
      {
        sourceType: 'document',
        documentId: 'doc-1',
        knowledgeBaseId: 'kb-1',
        title: 'Doc One',
        sourceUrl: 'https://example.com/one',
        score: 0.91,
        snippet: 'Document chunk content.',
      },
      {
        sourceType: 'ticket',
        ticketId: 'ticket-1',
        title: 'Ticket One',
        score: 0.89,
        snippet: 'Ticket chunk better score.',
      },
    ])
    expect(tokens).toEqual(['answer'])
  })

  it('keeps partial-context answers non-fallback and preserves sources', async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Port 51212 appears in one service context.',
        metadata: { documentId: 'doc-1' },
        score: 0.67,
      },
    ])
    whereMock.mockResolvedValue([
      { id: 'doc-1', title: 'Doc One', sourceUrl: 'https://example.com/one', knowledgeBaseId: 'kb-1' },
    ])
    streamMock.mockResolvedValue(
      (async function* () {
        yield {
          content: 'Found port 51212 in provided context, but exact REST API port is not stated.',
        }
      })(),
    )

    const { answerQuestion } = await import('./index')
    const result = await answerQuestion('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.isFallback).toBe(false)
    expect(tokens).toEqual([
      'Found port 51212 in provided context, but exact REST API port is not stated.',
    ])
    expect(result.sources).toEqual([
      {
        sourceType: 'document',
        documentId: 'doc-1',
        knowledgeBaseId: 'kb-1',
        title: 'Doc One',
        sourceUrl: 'https://example.com/one',
        score: 0.67,
        snippet: 'Port 51212 appears in one service context.',
      },
    ])
  })

  it('routes simple queries to the light path with fewer chunks even in graph mode', async () => {
    process.env.LANGGRAPH_ENABLED = 'true'
    similaritySearchMock.mockResolvedValue([
      { id: 'c1', content: 'x', metadata: { documentId: 'doc-1' }, score: 0.9 },
    ])
    whereMock.mockResolvedValue([{ id: 'doc-1', title: 'D', sourceUrl: null }])
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: 'a' }
      })(),
    )

    const { answerQuestion } = await import('./index')
    const result = await answerQuestion('What is SSO?', 'ws-1', 5)
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    // Simple query: light path with reduced chunk limit (3), no graph rewrite/grade.
    expect(similaritySearchMock).toHaveBeenCalledWith('What is SSO?', 'ws-1', 3, undefined, undefined)
    expect(tokens).toEqual(['a'])
  })

  it('returns fallback when retrieval empty', async () => {
    similaritySearchMock.mockResolvedValue([])
    const { answerQuestion } = await import('./index')

    const result = await answerQuestion('question', 'ws-1')
    const tokens: string[] = []
    for await (const token of result.stream) {
      tokens.push(token)
    }

    expect(result.isFallback).toBe(true)
    expect(result.sources).toEqual([])
    expect(tokens).toEqual(["I don't have enough information to answer that."])
  })
})
