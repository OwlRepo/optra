// A stand-in for the OpenAI HTTP API, so the browser suite exercises the real
// ingest and catalog pipelines without a key, a network or a bill.
//
// The API reaches it through OPENAI_BASE_URL, which openai@4 reads in its
// constructor and @langchain/openai passes through. It answers only what the
// storage paths need: embeddings for knowledge-base ingest and dataset
// profiling, and chat completions for catalog page extraction. Anything else
// is a 404, so a new model call shows up as a failing test, not a silent pass.
//
// Run: `bun stubs/openai-stub.ts` (PORT defaults to 4010).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const EMBEDDING_DIMENSIONS = 1536 // vector(1536), packages/db/src/schema/chunks.ts

export const CATALOG_STUB_ITEMS = [
  { sku: 'E2E-1', description: 'E2E widget', confidence: 0.9 },
  { sku: 'E2E-2', description: 'E2E gadget', confidence: 0.9 },
]

/** Deterministic unit vector per text, so identical inputs embed identically. */
function embed(text: string): Float32Array {
  let seed = 0
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0
  const vector = new Float32Array(EMBEDDING_DIMENSIONS)
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    vector[i] = Math.sin(seed + i)
    norm += vector[i] * vector[i]
  }
  const scale = 1 / Math.sqrt(norm)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) vector[i] *= scale
  return vector
}

function embeddings(body: any): unknown {
  const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input]
  // openai@4 asks for base64 unless told otherwise and decodes it itself, so
  // both encodings have to be answered in the shape that was requested.
  const base64 = body.encoding_format === 'base64'
  const data = inputs.map((input, index) => {
    const vector = embed(String(input))
    return {
      object: 'embedding',
      index,
      embedding: base64 ? Buffer.from(vector.buffer).toString('base64') : Array.from(vector),
    }
  })
  const tokens = inputs.reduce((sum, input) => sum + Math.ceil(String(input).length / 4), 0)
  return { object: 'list', data, model: body.model, usage: { prompt_tokens: tokens, total_tokens: tokens } }
}

function promptText(messages: any[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : (message.content ?? []).map((part: any) => part.text ?? '').join(' '),
    )
    .join('\n')
}

function chatCompletion(body: any): unknown {
  const prompt = promptText(body.messages ?? [])
  const content = /catalog product entries/i.test(prompt)
    ? JSON.stringify({ items: CATALOG_STUB_ITEMS })
    : 'e2e stub response'
  return {
    id: `chatcmpl-e2e-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    // Required: the API meters every call against the workspace token budget.
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const port = Number(process.env.PORT ?? 4010)

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  try {
    if (request.method === 'GET' && path === '/health') return send(response, 200, { ok: true })
    if (request.method === 'POST' && path === '/v1/embeddings') {
      return send(response, 200, embeddings(await readJson(request)))
    }
    if (request.method === 'POST' && path === '/v1/chat/completions') {
      return send(response, 200, chatCompletion(await readJson(request)))
    }
    console.error(`openai-stub: unhandled ${request.method} ${path}`)
    send(response, 404, { error: { message: `stub has no route for ${path}` } })
  } catch (error) {
    console.error('openai-stub:', error)
    send(response, 500, { error: { message: 'stub failure' } })
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`openai-stub listening on http://127.0.0.1:${port}`)
})
