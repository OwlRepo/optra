/**
 * The download's name. The API sends a non-ASCII name as RFC 5987
 * `filename*=UTF-8''…` beside an ASCII-only `filename` (B8); the real name
 * wins when it decodes, the quoted one otherwise.
 */
export function filenameFromDisposition(header: string | null, fallback: string) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim())
    } catch {
      // Malformed percent-encoding: fall through to the quoted name.
    }
  }
  const match = header?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? fallback
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(href)
}

/** Fetch a binary response and trigger a browser download, naming the file from Content-Disposition. */
export async function fetchDownload(path: string, init: RequestInit, fallbackFilename: string) {
  const response = await fetch(path, init)
  if (!response.ok) {
    // The API explains a refusal in JSON; surface its message, not a generic one.
    let message = 'Download failed'
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object' && 'message' in body) {
        const raw = (body as { message: unknown }).message
        const text = Array.isArray(raw) ? raw.join(', ') : raw
        if (typeof text === 'string' && text) message = text
      }
    } catch {
      // Not JSON: keep the generic message.
    }
    throw { statusCode: response.status, message }
  }
  const blob = await response.blob()
  saveBlob(blob, filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackFilename))
}
