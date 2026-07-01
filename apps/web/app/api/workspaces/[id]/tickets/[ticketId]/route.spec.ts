import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/tickets/[ticketId] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proxies GET ticket detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { id: 'ticket-1', title: 'OTP login loop' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/tickets/ticket-1', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', ticketId: 'ticket-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/tickets/ticket-1', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'ticket-1', title: 'OTP login loop' })
  })

  it('proxies PATCH edits and feedback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { id: 'ticket-1', title: 'Updated' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/tickets/ticket-1', {
      method: 'PATCH',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', usefulness: 'useful' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'ws-1', ticketId: 'ticket-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/tickets/ticket-1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated', usefulness: 'useful' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'ticket-1', title: 'Updated' })
  })
})
