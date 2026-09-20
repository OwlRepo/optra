import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

function makeRequest(url: string, init?: Omit<RequestInit, 'signal'>) {
  return new NextRequest(url, {
    ...init,
    headers: { cookie: 'mnemra_at=test-token', ...(init?.headers ?? {}) },
  })
}

const params = Promise.resolve({ id: 'ws-1', flagId: 'flag-1' })

describe('procurement discrepancy decisions route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the history read with the bearer', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )

    await GET(makeRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/flag-1/decisions'), {
      params,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/discrepancies/flag-1/decisions',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('forwards the decision body on write', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'd1' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
      )

    await POST(
      makeRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/flag-1/decisions', {
        method: 'POST',
        body: JSON.stringify({ outcome: 'resolved', note: 'Credit note received.' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/discrepancies/flag-1/decisions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ outcome: 'resolved', note: 'Credit note received.' }),
      }),
    )
  })

  it('returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    const response = await GET(
      new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/flag-1/decisions'),
      { params },
    )

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
