import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'

const WORKSPACE_ID = '6f1c2a40-0d5e-4b7a-9c11-2e8f4a3b5c01'
const USER_ID = 'c2b1a0f9-8e7d-4c6b-9a5f-4e3d2c1b0a99'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function removeRequest(userId: string, cookie: string | null = 'mnemra_at=test-access-token') {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/members/${userId}`, {
    method: 'DELETE',
    headers: cookie ? { cookie } : {},
  })
}

function params(userId: string) {
  return { params: Promise.resolve({ id: WORKSPACE_ID, userId }) }
}

describe('DELETE /api/workspaces/[id]/members/[userId] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: an admin (the route is owner-only) gets the API 403 unchanged', async () => {
    const body = { message: 'Insufficient workspace role', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await DELETE(removeRequest(USER_ID), params(USER_ID))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: removing the last owner gets the API 403 unchanged', async () => {
    const body = { message: 'Cannot remove the last owner', error: 'Forbidden', statusCode: 403 }
    stubBackend(jsonResponse(403, body))

    const response = await DELETE(removeRequest(USER_ID), params(USER_ID))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('error: a user who is not in the workspace gets the API 404 unchanged', async () => {
    const body = { message: 'Workspace member not found', error: 'Not Found', statusCode: 404 }
    stubBackend(jsonResponse(404, body))

    const response = await DELETE(removeRequest(USER_ID), params(USER_ID))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: a malformed user id reaches the API as-is and its 400 comes back', async () => {
    const body = { message: 'Validation failed (uuid is expected)', error: 'Bad Request', statusCode: 400 }
    const fetchMock = stubBackend(jsonResponse(400, body))

    const response = await DELETE(removeRequest('not-a-uuid'), params('not-a-uuid'))

    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:3001/workspaces/${WORKSPACE_ID}/members/not-a-uuid`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('edge: returns 401 without calling the API when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await DELETE(removeRequest(USER_ID, null), params(USER_ID))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy: sends DELETE with the bearer token and no body, and returns the API answer', async () => {
    const fetchMock = stubBackend(jsonResponse(200, { message: 'Member removed' }))

    const response = await DELETE(removeRequest(USER_ID), params(USER_ID))

    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:3001/workspaces/${WORKSPACE_ID}/members/${USER_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: 'Member removed' })
  })
})
