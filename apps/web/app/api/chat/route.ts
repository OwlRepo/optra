import { openai } from '@ai-sdk/openai'
import { type CoreMessage, streamText } from 'ai'

export const runtime = 'edge'

type SupportedRole = 'system' | 'user' | 'assistant'

function isValidRole(role: unknown): role is SupportedRole {
  return role === 'system' || role === 'user' || role === 'assistant'
}

function normalizeMessages(input: unknown): CoreMessage[] | null {
  if (!Array.isArray(input)) {
    return null
  }

  const messages: CoreMessage[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      return null
    }

    const role = 'role' in item ? item.role : undefined
    const content = 'content' in item ? item.content : undefined

    if (!isValidRole(role) || typeof content !== 'string' || !content.trim()) {
      return null
    }

    if (role === 'system') {
      messages.push({ role: 'system', content })
    }

    if (role === 'user') {
      messages.push({ role: 'user', content })
    }

    if (role === 'assistant') {
      messages.push({ role: 'assistant', content })
    }
  }

  return messages
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const messages = normalizeMessages(body?.messages)

    if (!messages) {
      return new Response('Invalid chat payload.', { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return new Response('Assistant service is not configured.', { status: 500 })
    }

    const result = await streamText({
      model: openai('gpt-4-turbo'),
      messages,
      system:
        'You are helpful support assistant with access to knowledge base. Answer clearly, accurately, and in calm language for non-technical support teams.',
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Chat route failed', error)
    return new Response('Assistant could not generate response right now.', { status: 500 })
  }
}
