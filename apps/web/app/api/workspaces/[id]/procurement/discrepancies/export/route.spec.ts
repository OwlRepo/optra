import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/workspaces/[id]/procurement/discrepancies/export proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: answers 401 without the access-token cookie and never reaches the backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/export')

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edge: a backend refusal keeps its status instead of becoming a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Forbidden"}', { status: 403 })))
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/export', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.status).toBe(403)
  })

  it('edge: the filter query string is forwarded untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/export?status=open&purchaseOrderId=po-1&invoiceId=inv-1&runId=run-1',
      { method: 'GET', headers: { cookie: 'mnemra_at=test-access-token' } },
    )

    await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/discrepancies/export?status=open&purchaseOrderId=po-1&invoiceId=inv-1&runId=run-1',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
  })

  it('regression: Cache-Control and nosniff from the API survive the hop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x', {
          status: 200,
          headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        }),
      ),
    )
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/export', {
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('happy: streams the workbook back with the API chosen Content-Disposition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('xlsx-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="optra-evidence-trail-2026-10-08.xlsx"',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('http://localhost:3000/api/workspaces/ws-1/procurement/discrepancies/export', {
      method: 'GET',
      headers: { cookie: 'mnemra_at=test-access-token' },
    })

    const response = await GET(request, { params: Promise.resolve({ id: 'ws-1' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/procurement/discrepancies/export',
      { method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, body: undefined },
    )
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="optra-evidence-trail-2026-10-08.xlsx"')
    expect(await response.text()).toBe('xlsx-bytes')
  })
})
