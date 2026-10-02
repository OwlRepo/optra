/**
 * The real name of an uploaded file (B8).
 *
 * Browsers send a multipart filename as raw UTF-8 (RFC 7578). Multer 2 builds
 * busboy without `defParamCharset`, so busboy decodes those bytes as latin1:
 * one character per byte, and "façture-日本.csv" arrives as mojibake. Re-reading
 * the same bytes as UTF-8 restores the name.
 *
 * Two names are left exactly as received:
 * - one holding a character above U+00FF, which busboy can only have produced
 *   from an RFC 5987 `filename*` it already decoded correctly;
 * - one whose bytes are not valid UTF-8 (a client that really sent latin1),
 *   which would only gain replacement characters.
 */
export function decodeUploadFilename(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[\u0100-\uffff]/.test(name)) {
    return name
  }
  const decoded = Buffer.from(name, 'latin1').toString('utf8')
  return decoded.includes('\ufffd') ? name : decoded
}
