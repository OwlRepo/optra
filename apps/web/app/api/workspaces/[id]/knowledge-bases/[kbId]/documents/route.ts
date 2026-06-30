import { NextRequest } from 'next/server'
import { proxyJson, proxyMultipart } from '../../../../../../../src/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string }> },
) {
  const { id, kbId } = await context.params
  return proxyJson(request, `/workspaces/${id}/knowledge-bases/${kbId}/documents`, { method: 'GET' })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string }> },
) {
  const { id, kbId } = await context.params
  return proxyMultipart(request, `/workspaces/${id}/knowledge-bases/${kbId}/documents`)
}
