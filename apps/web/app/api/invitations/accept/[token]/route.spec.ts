import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const TOKEN = 'ab'.repeat(32)
const BACKEND_URL = `http://localhost:3001/workspaces/accept-invite/${TOKEN}`

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function acceptRequest(cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(`http://localhost:3000/api/invitations/accept/${TOKEN}`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

function params() {
  return { params: Promise.resolve({ token: TOKEN }) }
}

describe('POST /api/invitations/accept/[token] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: an unknown invitation returns the API 404 unchanged', async () => {
    stubBackend(jsonResponse(404, { message: 'Invitation not found', error: 'Not Found', statusCode: 404 }))

    const response = await POST(acceptRequest(), params())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Invitation not found', error: 'Not Found', statusCode: 404 })
  })

  it('error: an invitation sent to another address returns the API 400 unchanged', async () => {
    const body = { message: 'Invitation email does not match logged-in user', error: 'Bad Request', statusCode: 400 }
    stubBackend(jsonResponse(400, body))

    const response = await POST(acceptRequest(), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: an expired invitation returns the API 400 unchanged', async () => {
    stubBackend(jsonResponse(400, { message: 'Invitation expired', error: 'Bad Request', statusCode: 400 }))

    const response = await POST(acceptRequest(), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: 'Invitation expired', error: 'Bad Request', statusCode: 400 })
  })

  it('edge: returns 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(acceptRequest(null), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy: accepts the invite as the signed-in user and returns the workspace', async () => {
    const workspace = { id: '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01', name: 'Ironclad buyers' }
    const fetchMock = stubBackend(jsonResponse(200, workspace))

    const response = await POST(acceptRequest(), params())

    expect(fetchMock).toHaveBeenCalledWith(BACKEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(workspace)
  })
})
