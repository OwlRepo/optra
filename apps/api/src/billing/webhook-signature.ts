import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Lemon Squeezy signs the raw request body: X-Signature is the lowercase hex
 * HMAC-SHA256 of those bytes with the webhook signing secret
 * (https://docs.lemonsqueezy.com/help/webhooks/signing-requests). Lengths are
 * compared first because timingSafeEqual throws on a mismatch.
 */
export function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8')
  const given = Buffer.from(signature, 'utf8')
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}
