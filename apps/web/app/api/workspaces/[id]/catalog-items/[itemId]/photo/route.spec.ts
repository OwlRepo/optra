import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const WORKSPACE_ID = '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01'
const ITEM_ID = '0b7f3c9e-2a1d-4e5f-8a6b-7c8d9e0f1a2b'
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function photoRequest(itemId: string, cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/catalog-items/${itemId}/photo`, {
    method: 'GET',
    headers: cookie ? { cookie } : {},
  })
}

function params(itemId: string) {
  return { params: Promise.resolve({ id: WORKSPACE_ID, itemId }) }
}

describe('GET /api/workspaces/[id]/catalog-items/[itemId]/photo proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: an item with no stored photo returns the API 404 and its reason', async () => {
    const body = { message: 'Catalog item has no photo', error: 'Not Found', statusCode: 404 }
    stubBackend(jsonResponse(404, body))

    const response = await GET(photoRequest(ITEM_ID), params(ITEM_ID))

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: a caller outside the workspace gets the API 403', async () => {
    const body = { message: 'Not a member of this workspace', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await GET(photoRequest(ITEM_ID), params(ITEM_ID))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: a malformed item id reaches the API as-is and its 400 comes back', async () => {
    const body = { message: 'Validation failed (uuid is expected)', error: 'Bad Request', statusCode: 400 }
    const fetchMock = stubBackend(jsonResponse(400, body))

    const response = await GET(photoRequest('not-a-uuid'), params('not-a-uuid'))

    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://localhost:3001/workspaces/${WORKSPACE_ID}/catalog-items/not-a-uuid/photo`,
    )
    expect(response.status).toBe(400)
  })

  it('edge: returns 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(photoRequest(ITEM_ID, null), params(ITEM_ID))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edge: headers outside the allow-list never reach the browser', async () => {
    stubBackend(
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'X-Powered-By': 'Express',
          ETag: 'W/"8-abc"',
          'Access-Control-Allow-Origin': '*',
        },
      }),
    )

    const response = await GET(photoRequest(ITEM_ID), params(ITEM_ID))

    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Powered-By')).toBeNull()
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it("happy: streams the photo bytes with the API's type, length, cache and nosniff headers", async () => {
    const fetchMock = stubBackend(
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '8',
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    )

    const response = await GET(photoRequest(ITEM_ID), params(ITEM_ID))

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3001/workspaces/${WORKSPACE_ID}/catalog-items/${ITEM_ID}/photo`,
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Content-Length')).toBe('8')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })
})
