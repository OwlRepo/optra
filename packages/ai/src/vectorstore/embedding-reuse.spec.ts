import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeMock, embedQueryMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  embedQueryMock: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  db: { execute: executeMock },
  chunks: {},
  tickets: {},
}))

vi.mock('../embeddings', () => ({
  embedQuery: embedQueryMock,
}))

import { similaritySearch, similaritySearchWithTicketSlot } from './index'

describe('vectorstore embedding reuse (#4 no double-embed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeMock.mockResolvedValue({ rows: [] })
    embedQueryMock.mockResolvedValue([0.9, 0.8, 0.7])
  })

  it('similaritySearch reuses a precomputed embedding without re-embedding', async () => {
    await similaritySearch('the query', 'ws-1', 5, [0.1, 0.2, 0.3])

    expect(embedQueryMock).not.toHaveBeenCalled()
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('similaritySearch embeds the query when no vector is supplied', async () => {
    await similaritySearch('the query', 'ws-1')

    expect(embedQueryMock).toHaveBeenCalledTimes(1)
    expect(embedQueryMock).toHaveBeenCalledWith('the query')
  })

  it('similaritySearchWithTicketSlot reuses a precomputed embedding without re-embedding', async () => {
    await similaritySearchWithTicketSlot('the query', 'ws-1', 5, [0.1, 0.2, 0.3])

    expect(embedQueryMock).not.toHaveBeenCalled()
    // one doc query + one ticket query, both using the supplied vector
    expect(executeMock).toHaveBeenCalledTimes(2)
  })

  it('similaritySearchWithTicketSlot embeds once when no vector is supplied', async () => {
    await similaritySearchWithTicketSlot('the query', 'ws-1')

    expect(embedQueryMock).toHaveBeenCalledTimes(1)
  })
})
