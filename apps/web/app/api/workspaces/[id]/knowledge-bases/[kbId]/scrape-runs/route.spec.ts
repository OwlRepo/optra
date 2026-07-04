import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('GET /api/workspaces/[id]/knowledge-bases/[kbId]/scrape-runs proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer and returns backend payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'run-1', status: 'running' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/scrape-runs?page=2&pageSize=5&q=docs&status=running', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/scrape-runs?page=2&pageSize=5&q=docs&status=running',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-access-token',
        },
        body: undefined,
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'run-1', status: 'running' }])
  })
})
