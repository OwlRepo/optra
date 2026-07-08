import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('GET /api/workspaces/[id]/insights/faq-drafts proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer and returns the backend payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'draft-1', question: 'q' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/insights/faq-drafts', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/insights/faq-drafts', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'draft-1', question: 'q' }])
  })

  it('returns 401 when no bearer cookie is present', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/insights/faq-drafts', { method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
  })
})
