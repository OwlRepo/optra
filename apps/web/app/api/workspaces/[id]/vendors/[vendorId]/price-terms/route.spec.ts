import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const WORKSPACE_ID = '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01'
const VENDOR_ID = '9a3e5b12-7c4d-4e8f-a1b2-c3d4e5f60718'
const PAGE_URL = `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/vendors/${VENDOR_ID}/price-terms`
const BACKEND_URL = `http://localhost:3001/workspaces/${WORKSPACE_ID}/vendors/${VENDOR_ID}/price-terms`
const TERM = { sku: 'IRN-38HXB', unitPrice: '0.42', currency: 'USD', effectiveFrom: '2026-01-01' }

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function listRequest(cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(PAGE_URL, { method: 'GET', headers: cookie ? { cookie } : {} })
}

function createRequest(body: unknown, cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(PAGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: WORKSPACE_ID, vendorId: VENDOR_ID }) }
}

describe('/api/workspaces/[id]/vendors/[vendorId]/price-terms proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("error: GET for another workspace's vendor returns the API 404 unchanged", async () => {
    const body = { message: 'Vendor not found', error: 'Not Found', statusCode: 404 }
    stubBackend(jsonResponse(404, body))

    const response = await GET(listRequest(), params())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: POST by a member without the owner or admin role gets the API 403 unchanged', async () => {
    const body = { message: 'Insufficient workspace role', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await POST(createRequest(TERM), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: POST backdated behind a live price returns the API 400 unchanged', async () => {
    const body = {
      message: 'A price for this item is already effective from that date or later. Record the new price from a later date',
      error: 'Bad Request',
      statusCode: 400,
    }
    stubBackend(jsonResponse(400, body))

    const response = await POST(createRequest(TERM), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: POST with a numeric unit price comes back as the API validation 400', async () => {
    const body = {
      message: ['unitPrice must be a non-negative decimal number, given as a string'],
      error: 'Bad Request',
      statusCode: 400,
    }
    stubBackend(jsonResponse(400, body))

    const response = await POST(createRequest({ ...TERM, unitPrice: 0.42 }), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: GET and POST return 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const list = await GET(listRequest(null), params())
    const create = await POST(createRequest(TERM, null), params())

    expect(list.status).toBe(401)
    expect(create.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy: GET lists the price terms with the bearer token', async () => {
    const terms = [{ ...TERM, id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e', effectiveTo: null }]
    const fetchMock = stubBackend(jsonResponse(200, terms))

    const response = await GET(listRequest(), params())

    expect(fetchMock).toHaveBeenCalledWith(BACKEND_URL, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(terms)
  })

  it('happy: POST forwards the new price term as JSON and returns the created row', async () => {
    const created = { ...TERM, id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e', effectiveTo: null }
    const fetchMock = stubBackend(jsonResponse(201, created))

    const response = await POST(createRequest(TERM), params())

    expect(fetchMock).toHaveBeenCalledWith(BACKEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(TERM),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(created)
  })
})
