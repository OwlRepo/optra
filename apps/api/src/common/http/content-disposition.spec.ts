import { validateHeaderValue } from 'http'
import { attachmentDisposition, safeContentDispositionFilename } from './content-disposition'

describe('safeContentDispositionFilename', () => {
  it('leaves an ordinary filename untouched', () => {
    expect(safeContentDispositionFilename('march-invoices.csv')).toBe('march-invoices.csv')
  })

  // A quote would close the quoted value early and let the remainder be read
  // as header parameters; CR/LF would start a new header entirely.
  it('replaces quotes and newlines that would break out of the header', () => {
    expect(safeContentDispositionFilename('a"b\nc.txt')).toBe('a_b_c.txt')
    expect(safeContentDispositionFilename('evil"\r\nSet-Cookie: x=1')).toBe('evil___Set-Cookie: x=1')
  })

  it('handles an empty name without throwing', () => {
    expect(safeContentDispositionFilename('')).toBe('')
  })

  // Spaces and non-ASCII are left alone on purpose: the value is always
  // emitted double-quoted, and this repo has no RFC 5987 support to encode
  // against (see the module comment).
  it('leaves spaces and non-ASCII characters alone', () => {
    expect(safeContentDispositionFilename('facture été.pdf')).toBe('facture été.pdf')
  })
})

describe('attachmentDisposition', () => {
  it('builds a quoted attachment header from a sanitized name', () => {
    expect(attachmentDisposition('report.txt')).toBe('attachment; filename="report.txt"')
    expect(attachmentDisposition('a"b\nc.txt')).toBe('attachment; filename="a_b_c.txt"')
  })

// B8. Once upload names keep their real characters, a name like
// "façture-日本.csv" reaches this header. Node refuses header characters
// above U+00FF, so the old quoted-only form made the download answer 500.
describe('attachmentDisposition for non-ASCII names (B8)', () => {
  it('error: a name with characters beyond latin1 still yields a header Node accepts', () => {
    expect(() => validateHeaderValue('Content-Disposition', attachmentDisposition('façture-日本.csv'))).not.toThrow()
  })

  it('edge: characters RFC 5987 reserves are percent-encoded in filename*, and the fallback stays sanitized', () => {
    expect(attachmentDisposition("rapport d'été (v2)*.csv")).toBe(
      "attachment; filename=\"rapport d'_t_ (v2)*.csv\"; filename*=UTF-8''rapport%20d%27%C3%A9t%C3%A9%20%28v2%29%2A.csv",
    )
  })

  it('regression: a non-ASCII name gets an ASCII fallback plus its UTF-8 filename*', () => {
    expect(attachmentDisposition('façture-日本.csv')).toBe(
      "attachment; filename=\"fa_ture-__.csv\"; filename*=UTF-8''fa%C3%A7ture-%E6%97%A5%E6%9C%AC.csv",
    )
  })

  it('happy: an ASCII name keeps the single quoted parameter', () => {
    expect(attachmentDisposition('march-invoices.csv')).toBe('attachment; filename="march-invoices.csv"')
  })
})
})
