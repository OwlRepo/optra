import { NextRequest } from 'next/server'
import { proxyRaw } from '@/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; ticketId: string }> },
) {
  const { id, ticketId } = await context.params
  return proxyRaw(request, `/workspaces/${id}/tickets/${ticketId}/transcript.pdf`, {
    method: 'GET',
  })
}
