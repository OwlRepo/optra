import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const WORKSPACE_ID = '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01'
const BACKEND_URL = `http://localhost:3001/workspaces/${WORKSPACE_ID}/invite`

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function inviteRequest(body: unknown, cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

describe('POST /api/workspaces/[id]/invite proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: a member without the owner or admin role gets the API 403 unchanged', async () => {
    const body = { message: 'Insufficient workspace role', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await POST(inviteRequest({ email: 'buyer@example.com' }), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: a caller outside the workspace gets the API 403 unchanged', async () => {
    const body = { message: 'Not a member of this workspace', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await POST(inviteRequest({ email: 'buyer@example.com' }), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: an invalid email comes back as the API validation 400', async () => {
    const body = { message: ['email must be an email'], error: 'Bad Request', statusCode: 400 }
    stubBackend(jsonResponse(400, body))

    const response = await POST(inviteRequest({ email: 'not-an-email' }), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: returns 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(inviteRequest({ email: 'buyer@example.com' }, null), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy: forwards the invite email as JSON with the bearer token', async () => {
    const fetchMock = stubBackend(jsonResponse(201, { message: 'Invite sent' }))

    const response = await POST(inviteRequest({ email: 'buyer@example.com' }), params())

    expect(fetchMock).toHaveBeenCalledWith(BACKEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@example.com' }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ message: 'Invite sent' })
  })
})
