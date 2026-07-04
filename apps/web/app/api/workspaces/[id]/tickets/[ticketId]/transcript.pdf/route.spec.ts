import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function mockPdfResponse() {
  return new Response('%PDF-1.4', {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="ticket.pdf"',
      'Content-Length': '8',
    },
  })
}

describe('GET /api/workspaces/[id]/tickets/[ticketId]/transcript.pdf proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams the backend PDF and preserves content headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockPdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/ws-1/tickets/ticket-1/transcript.pdf',
      {
        method: 'GET',
        headers: { cookie: 'mnemra_at=test-access-token' },
      },
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'ws-1', ticketId: 'ticket-1' }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/workspaces/ws-1/tickets/ticket-1/transcript.pdf',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test-access-token' },
        body: undefined,
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="ticket.pdf"')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    await expect(response.text()).resolves.toBe('%PDF-1.4')
  })
})
