import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET forwards bearer cookie to /workspaces/me and passes status/body through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'ws-1', name: 'Mine' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request)

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'ws-1', name: 'Mine' }])
  })

  it('missing mnemra_at cookie returns 401 and does not call backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces')
    const response = await GET(request)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })

  it('POST forwards JSON body to /workspaces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { id: 'ws-2', name: 'Team' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      headers: {
        cookie: 'mnemra_at=test-access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Team' }),
    })

    const response = await POST(request)

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Team' }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'ws-2', name: 'Team' })
  })
})
