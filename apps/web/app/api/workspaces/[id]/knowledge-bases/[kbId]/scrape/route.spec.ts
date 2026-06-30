import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('POST /api/workspaces/[id]/knowledge-bases/[kbId]/scrape proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer, body, status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(202, { runId: 'run-1', status: 'queued' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/scrape', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token' },
      body: JSON.stringify({ url: 'https://example.com/docs', maxDepth: 2 }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/scrape', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/docs', maxDepth: 2 }),
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ runId: 'run-1', status: 'queued' })
  })

  it('returns 401 when cookie missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/docs' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })
})
