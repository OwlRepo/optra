import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('GET /api/workspaces/[id]/digest-settings proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer and returns the backend payload', async () => {
    const payload = { emailEnabled: true, slackWebhookUrl: null, slackEnabled: false }
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, payload))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/digest-settings', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/digest-settings', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
  })

  it('returns 401 when no bearer cookie is present', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/digest-settings', { method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/workspaces/[id]/digest-settings proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the request body with bearer', async () => {
    const payload = { emailEnabled: false, slackWebhookUrl: null, slackEnabled: false }
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, payload))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/digest-settings', {
      method: 'PATCH',
      headers: { cookie: 'mnemra_at=test-access-token' },
      body: JSON.stringify({ emailEnabled: false }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/digest-settings', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: false }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
  })
})
