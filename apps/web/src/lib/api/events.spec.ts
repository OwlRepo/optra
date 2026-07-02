import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUnreadCount, listEvents, markEventsSeen } from './events'

describe('events api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists events through the same-origin proxy with cursor params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'evt-1', title: 'Imported doc' }], nextCursor: 'next-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listEvents('ws-1', { cursor: 'abc', limit: 5 })).resolves.toEqual({
      items: [{ id: 'evt-1', title: 'Imported doc' }],
      nextCursor: 'next-1',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/events?cursor=abc&limit=5', expect.any(Object))
  })

  it('reads unread count and marks events seen', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 3 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getUnreadCount('ws-1')).resolves.toEqual({ count: 3 })
    await expect(markEventsSeen('ws-1')).resolves.toEqual({})

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/ws-1/events/unread-count', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workspaces/ws-1/events/mark-seen',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
