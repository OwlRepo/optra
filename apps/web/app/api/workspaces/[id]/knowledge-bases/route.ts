import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../src/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return proxyJson(request, `/workspaces/${id}/knowledge-bases`, { method: 'GET' })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = await request.json()
  return proxyJson(request, `/workspaces/${id}/knowledge-bases`, { method: 'POST', body })
}
