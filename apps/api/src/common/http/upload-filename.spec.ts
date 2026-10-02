import { decodeUploadFilename } from './upload-filename'

// B8. Multer 2 builds busboy without `defParamCharset`, so busboy reads the
// filename bytes of a browser upload (UTF-8, RFC 7578) as latin1: one
// character per byte. "façture-日本.csv" arrived as "faÃ§ture-æ\u0097¥æ\u009c¬.csv".
describe('decodeUploadFilename (B8)', () => {
  it('edge: keeps a name whose bytes are not UTF-8 as the text it was read as', () => {
    // A client that really sent latin1 0xE9: re-reading it as UTF-8 would
    // only produce a replacement character, so the name is left alone.
    expect(decodeUploadFilename('caf\u00e9.csv')).toBe('café.csv')
  })

  it('edge: leaves a name that already holds characters beyond latin1 untouched', () => {
    // filename*=UTF-8''… is decoded correctly by busboy; it must not be decoded twice.
    expect(decodeUploadFilename('日本-façture.csv')).toBe('日本-façture.csv')
  })

  it('edge: leaves a plain ASCII name untouched', () => {
    expect(decodeUploadFilename('march-invoices.csv')).toBe('march-invoices.csv')
  })

  it('regression: restores a UTF-8 name the multipart parser read as latin1', () => {
    expect(decodeUploadFilename(Buffer.from('façture-日本.csv', 'utf8').toString('latin1'))).toBe('façture-日本.csv')
  })
})
