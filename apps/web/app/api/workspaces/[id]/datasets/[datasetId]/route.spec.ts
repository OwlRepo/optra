import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'

function mockBackendResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('DELETE /api/workspaces/[id]/datasets/[datasetId] proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the delete with bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(200, { message: 'Dataset deleted' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/datasets/ds-1', {
      method: 'DELETE',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'ws-1', datasetId: 'ds-1' }) })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/workspaces/ws-1/datasets/ds-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-access-token' },
      body: undefined,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: 'Dataset deleted' })
  })
})
