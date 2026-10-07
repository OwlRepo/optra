// A stand-in for the Lemon Squeezy REST API, so the browser suite exercises the
// real checkout and portal paths without a key, a network or a store.
// Only what slice S3 calls: POST /v1/checkouts and GET /v1/subscriptions/:id.
// Anything else is a 404. GET /__checkouts returns every checkout request body
// the stub has received, so a spec can assert on custom.workspace_id.
// Run: `bun stubs/lemonsqueezy-stub.ts` (PORT defaults to 4011).
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const STUB_API_KEY = 'lsk-e2e-stub' // support/env.ts passes the same value to the API
const port = Number(process.env.PORT ?? 4011)
const origin = `http://127.0.0.1:${port}`
const checkouts: unknown[] = []

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/vnd.api+json' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  try {
    if (request.method === 'GET' && path === '/health') return send(response, 200, { ok: true })
    if (request.method === 'GET' && path === '/__checkouts') return send(response, 200, checkouts)
    if (request.method === 'GET' && path.startsWith('/checkout/')) {
      response.writeHead(200, { 'content-type': 'text/html' })
      return response.end('<!doctype html><title>Stub checkout</title><h1>Stub checkout</h1>')
    }
    if (request.method === 'GET' && path.startsWith('/billing/')) {
      response.writeHead(200, { 'content-type': 'text/html' })
      return response.end('<!doctype html><title>Stub portal</title><h1>Stub portal</h1>')
    }
    if (request.headers.authorization !== `Bearer ${STUB_API_KEY}`) {
      return send(response, 401, { errors: [{ status: '401', title: 'Unauthenticated.' }] })
    }
    if (request.method === 'POST' && path === '/v1/checkouts') {
      const body = await readJson(request)
      checkouts.push(body)
      const id = randomUUID()
      return send(response, 201, { data: { type: 'checkouts', id, attributes: { url: `${origin}/checkout/${id}` } } })
    }
    const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(path)
    if (request.method === 'GET' && subscription) {
      return send(response, 200, {
        data: {
          type: 'subscriptions',
          id: subscription[1],
          attributes: { urls: { customer_portal: `${origin}/billing/${subscription[1]}`, update_payment_method: `${origin}/billing/${subscription[1]}/card` } },
        },
      })
    }
    console.error(`lemonsqueezy-stub: unhandled ${request.method} ${path}`)
    send(response, 404, { errors: [{ status: '404', title: `stub has no route for ${path}` }] })
  } catch (error) {
    console.error('lemonsqueezy-stub:', error)
    send(response, 500, { errors: [{ status: '500', title: 'stub failure' }] })
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`lemonsqueezy-stub listening on ${origin}`)
})
