import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/workspaces/[id]/procurement/invoices/[docId]/download proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('targets the invoices path on the backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('bytes', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="march-inv.xlsx"' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/procurement/invoices/doc-2/download',
      { method: 'GET', headers: { cookie: 'mnemra_at=test-access-token' } },
    )

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1', docId: 'doc-2' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/invoices/doc-2/download',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="march-inv.xlsx"')
  })
})
