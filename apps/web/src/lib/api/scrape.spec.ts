import { afterEach, describe, expect, it, vi } from 'vitest'
import { listScrapeRuns, scrapeSite } from './scrape'

describe('scrape api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks reusedExisting when backend returns 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runId: 'run-1', status: 'queued' }),
      }),
    )

    await expect(scrapeSite('ws-1', 'kb-1', { url: 'https://example.com/docs' })).resolves.toEqual({
      runId: 'run-1',
      status: 'queued',
      reusedExisting: true,
    })
  })

  it('marks reusedExisting false when backend returns 202', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ runId: 'run-1', status: 'queued' }),
      }),
    )

    await expect(scrapeSite('ws-1', 'kb-1', { url: 'https://example.com/docs' })).resolves.toEqual({
      runId: 'run-1',
      status: 'queued',
      reusedExisting: false,
    })
  })

  it('lists scrape runs through the same-origin proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ id: 'run-1', status: 'completed' }],
      }),
    )

    await expect(listScrapeRuns('ws-1', 'kb-1')).resolves.toEqual([{ id: 'run-1', status: 'completed' }])
  })
})
