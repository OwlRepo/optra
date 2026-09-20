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
})
