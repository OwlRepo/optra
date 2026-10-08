import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDownload, filenameFromDisposition } from './download'

// B8. The API now names a non-ASCII download with RFC 5987 `filename*` and an
// ASCII-only `filename` fallback; the browser must save it under the real name.
describe('filenameFromDisposition (B8)', () => {
  it('error: keeps the quoted filename when filename* cannot be decoded', () => {
    expect(filenameFromDisposition("attachment; filename=\"a_b.csv\"; filename*=UTF-8''%E6%97", 'document')).toBe('a_b.csv')
  })

  it('edge: falls back to the given name when there is no header', () => {
    expect(filenameFromDisposition(null, 'document')).toBe('document')
  })

  it('edge: reads the quoted filename when there is no filename*', () => {
    expect(filenameFromDisposition('attachment; filename="march-invoices.csv"', 'document')).toBe('march-invoices.csv')
  })

  it('regression: prefers the UTF-8 filename* over the ASCII fallback', () => {
    expect(
      filenameFromDisposition(
        "attachment; filename=\"fa_ture-__.csv\"; filename*=UTF-8''fa%C3%A7ture-%E6%97%A5%E6%9C%AC.csv",
        'document',
      ),
    ).toBe('façture-日本.csv')
  })
})

describe('fetchDownload failures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('error: a JSON error body surfaces its message instead of "Download failed"', async () => {
    const body = { statusCode: 422, message: 'Too many flags to export at once; narrow the filters' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status: 422, headers: { 'content-type': 'application/json' } }),
      ),
    )

    await expect(fetchDownload('/api/x', { method: 'GET' }, 'x.xlsx')).rejects.toEqual({
      statusCode: 422,
      message: 'Too many flags to export at once; narrow the filters',
    })
  })

  it('error: a non-JSON failure still rejects with the status and the generic message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    await expect(fetchDownload('/api/x', { method: 'GET' }, 'x.xlsx')).rejects.toEqual({
      statusCode: 500,
      message: 'Download failed',
    })
  })
})
