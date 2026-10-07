import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBilling, openPortal, startCheckout } from './billing'

describe('billing api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('error: a 409 from checkout is thrown as the API body', async () => {
    const body = { statusCode: 409, message: 'This workspace already has a subscription. Use Manage billing.' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => body }))

    await expect(startCheckout('ws-1', { plan: 'solo' })).rejects.toEqual(body)
  })

  it('edge: ids are placed in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await getBilling('ws-abc')
    await openPortal('ws-def')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/ws-abc/billing')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workspaces/ws-def/billing/portal')
  })

  it('happy: getBilling, startCheckout and openPortal call the BFF with the right method and body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: 'trialing' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ url: 'https://ls.test/c' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: 'https://ls.test/p' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBilling('ws-1')).resolves.toEqual({ state: 'trialing' })
    await expect(startCheckout('ws-1', { plan: 'team', seats: 3 })).resolves.toEqual({ url: 'https://ls.test/c' })
    await expect(openPortal('ws-1')).resolves.toEqual({ url: 'https://ls.test/p' })

    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workspaces/ws-1/billing/checkout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'team', seats: 3 }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/workspaces/ws-1/billing/portal',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
