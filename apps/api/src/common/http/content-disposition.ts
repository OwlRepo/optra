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
 * Deliberately narrow: it does NOT attempt RFC 5987 (`filename*=`) encoding
 * for non-ASCII names. Nothing in this repo emits or parses that form —
 * `apps/web/src/lib/http/download.ts` reads only `filename=` — so adding it
 * here would produce a header the client helper cannot read.
 */
export function safeContentDispositionFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

/** `attachment; filename="..."` with the name sanitized. */
export function attachmentDisposition(name: string): string {
  return `attachment; filename="${safeContentDispositionFilename(name)}"`
}
