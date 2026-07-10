import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('/api/workspaces/[id]/procurement/discrepancies/compare proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when access-token cookie missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/compare', {
      method: 'POST',
      body: JSON.stringify({ purchaseOrderId: 'po-1', invoiceId: 'inv-1' }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies POST body with bearer token to the correct backend path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockBackendResponse(201, { flags: [{ id: 'flag-1', type: 'amount_mismatch' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/compare', {
      method: 'POST',
      headers: { cookie: 'mnemra_at=test-access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ purchaseOrderId: 'po-1', invoiceId: 'inv-1' }),
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'ws-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/procurement/discrepancies/compare', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purchaseOrderId: 'po-1', invoiceId: 'inv-1' }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ flags: [{ id: 'flag-1', type: 'amount_mismatch' }] })
  })
})
