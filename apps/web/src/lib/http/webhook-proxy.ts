import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

// Lemon Squeezy bodies are a few KB; the API parser caps JSON at 1 MB too.
export const WEBHOOK_MAX_BYTES = 1024 * 1024

function tooLarge() {
  return NextResponse.json({ message: 'Payload too large' }, { status: 413 })
}

// Reads the body as raw bytes, stopping as soon as the cap is crossed so a
// hostile sender cannot make us buffer more than WEBHOOK_MAX_BYTES + one chunk.
async function readCapped(request: NextRequest): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BYTES) return null

  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > WEBHOOK_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Forwards a signed webhook to the API byte-for-byte. The HMAC is computed over
 * the exact bytes the sender posted, so the body is never parsed or re-encoded
 * here. No bearer and no cookies: the signature is the credential.
 */
export async function forwardRaw(request: NextRequest, backendPath: string) {
  const bytes = await readCapped(request)
  if (bytes === null) return tooLarge()

  const signature = request.headers.get('x-signature')
  const eventName = request.headers.get('x-event-name')

  let response: Response
  try {
    response = await fetch(`${API_URL}${backendPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') ?? 'application/json',
        ...(signature ? { 'x-signature': signature } : {}),
        ...(eventName ? { 'x-event-name': eventName } : {}),
      },
      body: bytes as BodyInit,
    })
  } catch {
    return NextResponse.json({ message: 'Bad gateway' }, { status: 502 })
  }

  const data = await response.json().catch(() => ({}))
  return NextResponse.json(data, { status: response.status })
}
