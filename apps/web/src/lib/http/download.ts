function filenameFromDisposition(header: string | null, fallback: string) {
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
  const blob = await response.blob()
  if (!response.ok) {
    throw { statusCode: response.status, message: 'Download failed' }
  }
  saveBlob(blob, filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackFilename))
}
