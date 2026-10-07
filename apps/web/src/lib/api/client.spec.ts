/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, uploadFile, uploadFiles } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns data on a successful response without attempting a refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    const result = await apiFetch('/api/workspaces')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on a non-401 error without attempting a refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'Server error' }))

    await expect(apiFetch('/api/workspaces')).rejects.toEqual({ message: 'Server error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on 401, refreshes the session and retries the original request once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // POST /api/auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { items: [] })) // retried original request

    const result = await apiFetch('/api/workspaces')

    expect(result).toEqual({ items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/workspaces')
  })

  it('on 401, throws the original error if the refresh attempt fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })) // refresh fails

    await expect(apiFetch('/api/workspaces')).rejects.toEqual({ message: 'Unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('on 401, throws the retried error if the retry still fails after a successful refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // refresh succeeds
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' })) // retry still fails

    await expect(apiFetch('/api/workspaces')).rejects.toEqual({ message: 'Forbidden' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not attempt a refresh when the refresh endpoint itself returns 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    await expect(apiFetch('/api/auth/refresh', { method: 'POST' })).rejects.toEqual({
      message: 'Unauthorized',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['/api/auth/login', '/api/auth/register', '/api/auth/verify-otp'])(
    'does not attempt a refresh for the unauthenticated endpoint %s',
    async (path) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid credentials' }))

      await expect(apiFetch(path, { method: 'POST' })).rejects.toEqual({
        message: 'Invalid credentials',
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('shares a single in-flight refresh across concurrent 401s', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })) // call A original
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })) // call B original
      .mockResolvedValueOnce(jsonResponse(200, {})) // shared refresh
      .mockResolvedValueOnce(jsonResponse(200, { id: 'a' })) // call A retry
      .mockResolvedValueOnce(jsonResponse(200, { id: 'b' })) // call B retry

    const [resultA, resultB] = await Promise.all([apiFetch('/api/a'), apiFetch('/api/b')])

    expect(resultA).toEqual({ id: 'a' })
    expect(resultB).toEqual({ id: 'b' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const refreshCalls = fetchMock.mock.calls.filter(([path]) => path === '/api/auth/refresh')
    expect(refreshCalls).toHaveLength(1)
  })
})

describe('uploadFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns data on a successful upload without attempting a refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'doc-1' }))

    const result = await uploadFile('/api/workspaces/w1/documents', file)

    expect(result).toEqual({ id: 'doc-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on 401, refreshes the session and retries the upload once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // refresh
      .mockResolvedValueOnce(jsonResponse(200, { id: 'doc-1' })) // retried upload

    const result = await uploadFile('/api/workspaces/w1/documents', file)

    expect(result).toEqual({ id: 'doc-1' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('on 401, throws the original error if the refresh attempt fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    await expect(uploadFile('/api/workspaces/w1/documents', file)).rejects.toEqual({
      message: 'Unauthorized',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('billing stop notice (S4)', () => {
  const EVENT = 'optra:billing-stop'
  const STOP = {
    statusCode: 402,
    message: "Your plan's AI allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
    code: 'AI_BUDGET_EXCEEDED',
  }
  let fetchMock: ReturnType<typeof vi.fn>
  let handler: ReturnType<typeof vi.fn<(event: Event) => void>>
  const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    handler = vi.fn<(event: Event) => void>()
    window.addEventListener(EVENT, handler)
  })

  afterEach(() => {
    window.removeEventListener(EVENT, handler)
    vi.unstubAllGlobals()
  })

  it('error: a 402 without a code throws the body and dispatches nothing', async () => {
    const legacy = { statusCode: 402, message: 'Workspace monthly token budget reached' }
    fetchMock.mockResolvedValueOnce(jsonResponse(402, legacy))

    await expect(apiFetch('/api/workspaces/w1/refine', { method: 'POST' })).rejects.toEqual(legacy)

    expect(handler).not.toHaveBeenCalled()
  })

  it('edge: apiFetch dispatches optra:billing-stop once for a coded 402 and still throws the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, STOP))

    await expect(apiFetch('/api/workspaces/w1/refine', { method: 'POST' })).rejects.toEqual(STOP)

    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual(STOP)
  })

  it('edge: uploadFile and uploadFiles dispatch the same event', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, STOP)).mockResolvedValueOnce(jsonResponse(402, STOP))

    await expect(uploadFile('/api/workspaces/w1/procurement/purchase-orders', file)).rejects.toEqual(STOP)
    await expect(uploadFiles('/api/workspaces/w1/procurement/purchase-orders/photos', [file])).rejects.toEqual(STOP)

    expect(handler).toHaveBeenCalledTimes(2)
    for (const [event] of handler.mock.calls) expect((event as CustomEvent).detail).toEqual(STOP)
  })

  it('regression: a 401 that refreshes and then answers a coded 402 dispatches the event', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // refresh
      .mockResolvedValueOnce(jsonResponse(402, STOP)) // retried request

    await expect(apiFetch('/api/workspaces/w1/refine', { method: 'POST' })).rejects.toEqual(STOP)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('happy: a 200 dispatches nothing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    await expect(apiFetch('/api/workspaces/w1/billing')).resolves.toEqual({ ok: true })

    expect(handler).not.toHaveBeenCalled()
  })
})
