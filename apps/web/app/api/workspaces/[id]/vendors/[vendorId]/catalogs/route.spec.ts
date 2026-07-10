import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/vendors/[vendorId]/catalogs proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 for GET when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies GET with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'catalog-1', status: 'ready' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/vendors/v-1/catalogs', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-access-token',
      },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'catalog-1', status: 'ready' }])
  })

  it('returns 401 for POST when access-token cookie missing', async () => {
    const form = new FormData()
    form.append('file', new File(['a,b\n1,2'], 'catalog.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs', {
      method: 'POST',
      body: form,
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('forwards multipart FormData with bearer and no JSON content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { id: 'catalog-1', status: 'pending' }))
    vi.stubGlobal('fetch', fetchMock)

    const form = new FormData()
    form.append('file', new File(['a,b\n1,2'], 'catalog.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/vendors/v-1/catalogs', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token' },
      body: form,
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1', vendorId: 'v-1' }),
    })

    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('http://localhost:3001/workspaces/ws-1/vendors/v-1/catalogs')
    expect(call?.[1]?.method).toBe('POST')
    expect(call?.[1]?.headers).toEqual({ Authorization: 'Bearer test-access-token' })
    expect(call?.[1]?.body).toBeInstanceOf(FormData)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'catalog-1', status: 'pending' })
  })
})
