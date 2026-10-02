import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './download'

// B8. The API now names a non-ASCII download with RFC 5987 `filename*` and an
// ASCII-only `filename` fallback; the browser must save it under the real name.
describe('filenameFromDisposition (B8)', () => {
  it('edge: falls back to the given name when there is no header', () => {
    expect(filenameFromDisposition(null, 'document')).toBe('document')
  })

  it('edge: reads the quoted filename when there is no filename*', () => {
    expect(filenameFromDisposition('attachment; filename="march-invoices.csv"', 'document')).toBe('march-invoices.csv')
  })

  it('edge: keeps the quoted filename when filename* cannot be decoded', () => {
    expect(filenameFromDisposition("attachment; filename=\"a_b.csv\"; filename*=UTF-8''%E6%97", 'document')).toBe('a_b.csv')
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
