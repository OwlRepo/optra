/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadTicketTranscript, listTickets } from './tickets'

describe('tickets api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('listTickets hits the endpoint with no query when no options are passed', async () => {
    const fetchMock = stubFetch()

    await listTickets('ws-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/tickets', expect.any(Object))
  })

  it('listTickets serializes offset, search, and filter params', async () => {
    const fetchMock = stubFetch()

    await listTickets('ws-1', {
      page: 2,
      pageSize: 10,
      q: 'login',
      status: 'failed',
      severity: 'high',
      usefulness: 'useful',
      indexed: 'true',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/tickets?page=2&pageSize=10&q=login&status=failed&severity=high&usefulness=useful&indexed=true',
      expect.any(Object),
    )
  })

  it('downloadTicketTranscript fetches the PDF endpoint and triggers a browser download', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="ticket.pdf"' }),
      blob: async () => new Blob(['%PDF-1.4']),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadTicketTranscript('ws-1', 'ticket-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/tickets/ticket-1/transcript.pdf',
      expect.objectContaining({ method: 'GET' }),
    )

    vi.restoreAllMocks()
  })
})
