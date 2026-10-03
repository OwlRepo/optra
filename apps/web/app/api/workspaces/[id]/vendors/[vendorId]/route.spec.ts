import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const WORKSPACE_ID = '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01'
const VENDOR_ID = '9a3e5b12-7c4d-4e8f-a1b2-c3d4e5f60718'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function vendorRequest(vendorId: string, cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/vendors/${vendorId}`, {
    method: 'GET',
    headers: cookie ? { cookie } : {},
  })
}

function params(vendorId: string) {
  return { params: Promise.resolve({ id: WORKSPACE_ID, vendorId }) }
}

describe('GET /api/workspaces/[id]/vendors/[vendorId] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("error: another workspace's vendor id returns the API 404 unchanged", async () => {
    const body = { message: 'Vendor not found', error: 'Not Found', statusCode: 404 }
    stubBackend(jsonResponse(404, body))

    const response = await GET(vendorRequest(VENDOR_ID), params(VENDOR_ID))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: a caller outside the workspace gets the API 403 unchanged', async () => {
    const body = { message: 'Not a member of this workspace', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await GET(vendorRequest(VENDOR_ID), params(VENDOR_ID))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: a malformed vendor id reaches the API as-is and its 400 comes back', async () => {
    const body = { message: 'Validation failed (uuid is expected)', error: 'Bad Request', statusCode: 400 }
    const fetchMock = stubBackend(jsonResponse(400, body))

    const response = await GET(vendorRequest('not-a-uuid'), params('not-a-uuid'))

    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:3001/workspaces/${WORKSPACE_ID}/vendors/not-a-uuid`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: returns 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(vendorRequest(VENDOR_ID, null), params(VENDOR_ID))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy: fetches the vendor with the bearer token and returns it', async () => {
    const vendor = { id: VENDOR_ID, name: 'Ironclad Supply' }
    const fetchMock = stubBackend(jsonResponse(200, vendor))

    const response = await GET(vendorRequest(VENDOR_ID), params(VENDOR_ID))

    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:3001/workspaces/${WORKSPACE_ID}/vendors/${VENDOR_ID}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(vendor)
  })
})
