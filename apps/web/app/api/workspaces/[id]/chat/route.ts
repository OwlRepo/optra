import { NextRequest, NextResponse } from 'next/server'
import { getBearer } from '@/lib/http/auth-proxy'

export const runtime = 'nodejs'

const API_URL = process.env.API_URL || 'http://localhost:3001'

type IncomingChatMessage = {
  role?: string
  content?: string
}

function extractMessage(body: unknown): { message: string; sessionId?: string } | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const candidate = body as {
    messages?: IncomingChatMessage[]
    sessionId?: unknown
  }

  const messages = Array.isArray(candidate.messages) ? candidate.messages : []
  const lastUserMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message?.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0,
    )

  if (!lastUserMessage?.content) {
    return null
  }

  return {
    message: lastUserMessage.content,
    sessionId:
      typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0
        ? candidate.sessionId
        : undefined,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const bearer = getBearer(request)

  if (!bearer) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const payload = extractMessage(body)

  if (!payload) {
    return NextResponse.json({ message: 'Invalid chat payload.' }, { status: 400 })
  }

  const backendRes = await fetch(`${API_URL}/workspaces/${params.id}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const headers = new Headers()
  const contentType = backendRes.headers.get('content-type')
  const sources = backendRes.headers.get('x-chat-sources')
  const sessionId = backendRes.headers.get('x-chat-session-id')
  const structuredState = backendRes.headers.get('x-chat-structured-state')
  const structuredCandidates = backendRes.headers.get('x-chat-structured-candidates')

  if (contentType) headers.set('Content-Type', contentType)
  if (sources) headers.set('X-Chat-Sources', sources)
  if (sessionId) headers.set('X-Chat-Session-Id', sessionId)
  if (structuredState) headers.set('X-Chat-Structured-State', structuredState)
  if (structuredCandidates) headers.set('X-Chat-Structured-Candidates', structuredCandidates)

  return new Response(backendRes.body, {
    status: backendRes.status,
    headers,
  })
}
