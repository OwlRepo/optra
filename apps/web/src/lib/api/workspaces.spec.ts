import { afterEach, describe, expect, it, vi } from 'vitest'
import { listMembers } from './workspaces'

describe('workspaces api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('listMembers hits the members endpoint with no query when no options are passed', async () => {
    const fetchMock = stubFetch()

    await listMembers('ws-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/members', expect.any(Object))
  })

  it('listMembers serializes offset, search, and role filter params', async () => {
    const fetchMock = stubFetch()

    await listMembers('ws-1', { page: 2, pageSize: 10, q: 'needle', role: 'member' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/members?page=2&pageSize=10&q=needle&role=member',
      expect.any(Object),
    )
  })
})
