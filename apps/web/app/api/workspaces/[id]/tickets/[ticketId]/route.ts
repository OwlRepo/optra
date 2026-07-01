import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; ticketId: string }> },
) {
  const { id, ticketId } = await context.params
  return proxyJson(request, `/workspaces/${id}/tickets/${ticketId}`, { method: 'GET' })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; ticketId: string }> },
) {
  const { id, ticketId } = await context.params
  return proxyJson(request, `/workspaces/${id}/tickets/${ticketId}`, {
    method: 'PATCH',
    body: await request.json(),
  })
}
