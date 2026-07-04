import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRefineStatus,
  listSavedRefinedMessages,
  refineMessage,
  saveRefinedMessage,
} from './refine'

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response
}

describe('refine client lib', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refineMessage POSTs text to the refine proxy path', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, { original: 'raw', refined: 'clean' }),
    )

    const result = await refineMessage('ws-1', 'raw')

    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/refine',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'raw' }) }),
    )
    expect(result).toEqual({ original: 'raw', refined: 'clean' })
  })

  it('getRefineStatus GETs the status proxy path', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, { used: 1, limit: 20, remaining: 19 }),
    )

    const result = await getRefineStatus('ws-1')

    expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-1/refine/status', expect.anything())
    expect(result).toEqual({ used: 1, limit: 20, remaining: 19 })
  })

  it('saveRefinedMessage POSTs to the saved proxy path', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(201, { id: 'm-1', originalText: 'a', refinedText: 'b', createdAt: '2026-07-04' }),
    )

    const result = await saveRefinedMessage('ws-1', { originalText: 'a', refinedText: 'b' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/refine/saved',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ originalText: 'a', refinedText: 'b' }),
      }),
    )
    expect(result.id).toBe('m-1')
  })

  it('listSavedRefinedMessages GETs the saved proxy path', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, { items: [{ id: 'm-1', originalText: 'a', refinedText: 'b', createdAt: '2026-07-04' }] }),
    )

    const result = await listSavedRefinedMessages('ws-1')

    expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-1/refine/saved', expect.anything())
    expect(result.items).toHaveLength(1)
  })
})
