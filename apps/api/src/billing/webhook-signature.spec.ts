import { createHmac } from 'crypto'
import { verifySignature } from './webhook-signature'

const SECRET = 'whsec-unit-test'
const sign = (body: Buffer, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex')

describe('verifySignature', () => {
  const body = Buffer.from('{"meta":{"event_name":"subscription_created"},"data":{"id":"1"}}', 'utf8')

  it('error: a missing signature is rejected', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false)
    expect(verifySignature(body, '', SECRET)).toBe(false)
  })

  it('error: a signature of the wrong length is rejected without throwing', () => {
    expect(() => verifySignature(body, 'abc123', SECRET)).not.toThrow()
    expect(verifySignature(body, 'abc123', SECRET)).toBe(false)
    expect(verifySignature(body, `${sign(body)}00`, SECRET)).toBe(false)
  })

  it('error: a signature over different bytes is rejected', () => {
    const other = Buffer.from('{"meta":{"event_name":"subscription_created"},"data":{"id":"2"}}', 'utf8')
    expect(verifySignature(body, sign(other), SECRET)).toBe(false)
  })

  it('error: the right secret over re-serialized JSON (key order and whitespace changed) is rejected', () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2), 'utf8')
    expect(reserialized.equals(body)).toBe(false)
    expect(verifySignature(reserialized, sign(body), SECRET)).toBe(false)
    const reordered = Buffer.from('{"data":{"id":"1"},"meta":{"event_name":"subscription_created"}}', 'utf8')
    expect(verifySignature(reordered, sign(body), SECRET)).toBe(false)
  })

  it('edge: an empty secret never verifies', () => {
    expect(verifySignature(body, sign(body, ''), '')).toBe(false)
  })

  it('edge: uppercase hex of the right digest is rejected', () => {
    const digest = sign(body)
    expect(digest).not.toBe(digest.toUpperCase())
    expect(verifySignature(body, digest.toUpperCase(), SECRET)).toBe(false)
  })

  it('edge: a body with non-ASCII bytes verifies over the raw bytes', () => {
    const raw = Buffer.from('{"data":{"attributes":{"user_name":"José Müller 王 \u{1F680}"}}}', 'utf8')
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true)
  })

  it('happy: the correct HMAC-SHA256 hex of the raw bytes verifies', () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true)
  })
})
