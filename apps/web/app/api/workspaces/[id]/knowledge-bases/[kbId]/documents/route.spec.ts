import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('POST /api/workspaces/[id]/knowledge-bases/[kbId]/documents proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards multipart FormData with bearer and no JSON content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { id: 'doc-1', status: 'pending' }))
    vi.stubGlobal('fetch', fetchMock)

    const form = new FormData()
    form.append('file', new File(['hello'], 'test.txt', { type: 'text/plain' }))

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token' },
      body: form,
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/documents')
    expect(call?.[1]?.method).toBe('POST')
    expect(call?.[1]?.headers).toEqual({
      Authorization: 'Bearer test-access-token',
    })
    expect(call?.[1]?.body).toBeInstanceOf(FormData)
    expect('Content-Type' in (call?.[1]?.headers ?? {})).toBe(false)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'doc-1', status: 'pending' })
  })
})

describe('GET /api/workspaces/[id]/knowledge-bases/[kbId]/documents proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards query params with bearer and returns backend payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { items: [], page: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/knowledge-bases/kb-1/documents?page=2&pageSize=10&q=guide&status=done',
      {
        method: 'GET',
        headers: { cookie: 'mnemra_at=test-access-token' },
      },
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', kbId: 'kb-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/knowledge-bases/kb-1/documents?page=2&pageSize=10&q=guide&status=done',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-access-token',
        },
        body: undefined,
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], page: 2 })
  })
})
