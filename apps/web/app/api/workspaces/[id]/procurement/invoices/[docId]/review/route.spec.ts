import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const params = Promise.resolve({ id: 'ws-1', docId: 'doc-1' })
const URL = 'http://localhost:3000/api/workspaces/ws-1/procurement/invoices/doc-1/review'
const body = { lines: [{ id: 'line-1', quantity: '12' }, { description: 'Added by hand' }] }

function post(headers: Record<string, string> = {}) {
  return new NextRequest(URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('POST /api/workspaces/[id]/procurement/invoices/[docId]/review proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('error: returns 401 without calling the backend when the auth cookie is missing', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    const response = await POST(post(), { params })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error: passes a backend 409 (already reviewed) through with its message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'already reviewed' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    )

    const response = await POST(post({ cookie: 'mnemra_at=test-token' }), { params })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ message: 'already reviewed' })
  })

  it('happy: forwards the reviewed lines as JSON to the review path with the bearer', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'doc-1', reviewedAt: '2026-10-06T00:00:00.000Z', rowCount: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const response = await POST(post({ cookie: 'mnemra_at=test-token' }), { params })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/invoices/doc-1/review',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }),
      }),
    )
    expect(response.status).toBe(200)
  })
})
