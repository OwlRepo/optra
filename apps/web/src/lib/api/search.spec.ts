import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchWorkspace } from './search'

describe('search api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the grouped search endpoint with encoded query text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [], tickets: [], chatMessages: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchWorkspace('ws-1', 'login issue')).resolves.toEqual({
      documents: [],
      tickets: [],
      chatMessages: [],
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/search?q=login+issue', expect.any(Object))
  })

  it('forwards an AbortSignal so an in-flight request can be cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [], tickets: [], chatMessages: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await searchWorkspace('ws-1', 'login issue', { signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/search?q=login+issue',
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
