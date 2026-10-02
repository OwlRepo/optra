/**
 * Makes a stored filename safe to interpolate into a quoted
 * `Content-Disposition` value.
 *
 * The name comes from `file.originalname` at upload time and is never
 * validated, so it can contain a double quote (which would end the quoted
 * string early and let the rest be read as header parameters) or a CR/LF
 * (header injection). Both become `_`.
 *
 * Extracted here because the same regex previously lived in two controllers
 * independently — `documents.controller.ts` defined `safeFilename` and
 * `tickets.controller.ts` inlined the identical expression. A security-
 * relevant sanitizer with N copies has N chances to drift.
 *
 * Non-ASCII is left alone here; `attachmentDisposition` handles it.
 */
export function safeContentDispositionFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

// RFC 5987 attr-char excludes these, and encodeURIComponent leaves them as-is.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * `attachment; filename="..."` with the name sanitized. A non-ASCII name (B8)
 * also gets `filename*=UTF-8''…` and an ASCII-only fallback: Node refuses
 * header characters above U+00FF, so the bare quoted form made such a
 * download answer 500. `apps/web/src/lib/http/download.ts` prefers `filename*`.
 */
export function attachmentDisposition(name: string): string {
  const safe = safeContentDispositionFilename(name)
  if (!/[^\x20-\x7e]/.test(safe)) {
    return `attachment; filename="${safe}"`
  }
  const fallback = safe.replace(/[^\x20-\x7e]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(safe)}`
}
