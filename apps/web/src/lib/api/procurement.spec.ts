import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchDownloadMock = vi.fn()

vi.mock('../http/download', () => ({
  fetchDownload: (...args: unknown[]) => fetchDownloadMock(...args),
}))

import { exportEvidenceTrail } from './procurement'

describe('exportEvidenceTrail', () => {
  beforeEach(() => {
    fetchDownloadMock.mockReset().mockResolvedValue(undefined)
  })

  it('error: a failed download rejects with the thrown error so the page can toast it', async () => {
    const failure = { statusCode: 422, message: 'Too many flags to export at once; narrow the filters' }
    fetchDownloadMock.mockRejectedValue(failure)

    await expect(exportEvidenceTrail('ws-1', {})).rejects.toEqual(failure)
  })

  it('edge: no filters means no query string', async () => {
    await exportEvidenceTrail('ws-1', {})

    expect(fetchDownloadMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/procurement/discrepancies/export',
      { method: 'GET' },
      'optra-evidence-trail.xlsx',
    )
  })

  it('edge: empty and undefined filters are left out of the query', async () => {
    await exportEvidenceTrail('ws-1', { purchaseOrderId: '', invoiceId: undefined, status: 'dismissed' })

    expect(fetchDownloadMock.mock.calls[0][0]).toBe(
      '/api/workspaces/ws-1/procurement/discrepancies/export?status=dismissed',
    )
  })

  it('happy: every filter goes into the query and the file is fetched through fetchDownload', async () => {
    await exportEvidenceTrail('ws-9', { purchaseOrderId: 'po-1', invoiceId: 'inv-1', status: 'open', runId: 'run-1' })

    const [path, init, fallback] = fetchDownloadMock.mock.calls[0]
    const url = new URL(path as string, 'http://localhost')
    expect(url.pathname).toBe('/api/workspaces/ws-9/procurement/discrepancies/export')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      purchaseOrderId: 'po-1',
      invoiceId: 'inv-1',
      status: 'open',
      runId: 'run-1',
    })
    expect(init).toEqual({ method: 'GET' })
    expect(fallback).toBe('optra-evidence-trail.xlsx')
  })
})
