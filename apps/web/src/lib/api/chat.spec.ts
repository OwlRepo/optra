import { afterEach, describe, expect, it, vi } from 'vitest'
import { listChatSessions } from './chat'

describe('chat api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('listChatSessions hits the endpoint with no query when no options are passed', async () => {
    const fetchMock = stubFetch()

    await listChatSessions('ws-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/chat/sessions', expect.any(Object))
  })

  it('listChatSessions serializes offset and search params', async () => {
    const fetchMock = stubFetch()

    await listChatSessions('ws-1', { page: 2, pageSize: 5, q: 'billing' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/chat/sessions?page=2&pageSize=5&q=billing',
      expect.any(Object),
    )
  })
})
