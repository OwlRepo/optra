import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('POST /api/workspaces/[id]/procurement/goods-receipts proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards multipart FormData with bearer and no JSON content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(201, { id: 'grn-1', status: 'pending' }))
    vi.stubGlobal('fetch', fetchMock)

    const form = new FormData()
    form.append('file', new File(['sku,qty received\nA1,8'], 'grn.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/goods-receipts', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token' },
      body: form,
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'ws-1' }) })

    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('http://localhost:3001/workspaces/ws-1/procurement/goods-receipts')
    expect(call?.[1]?.method).toBe('POST')
    expect(call?.[1]?.headers).toEqual({ Authorization: 'Bearer test-access-token' })
    expect(call?.[1]?.body).toBeInstanceOf(FormData)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'grn-1', status: 'pending' })
  })

  it('returns 401 when no bearer cookie is present', async () => {
    const form = new FormData()
    form.append('file', new File(['sku,qty received\nA1,8'], 'grn.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/goods-receipts', {
      method: 'POST',
      body: form,
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
  })
})

describe('GET /api/workspaces/[id]/procurement/goods-receipts proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards bearer and returns the backend payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, [{ id: 'grn-1', grnNumber: 'GRN-9001' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/goods-receipts', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/procurement/goods-receipts', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{ id: 'grn-1', grnNumber: 'GRN-9001' }])
  })

  it('returns 401 when no bearer cookie is present', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/goods-receipts', { method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
  })
})
