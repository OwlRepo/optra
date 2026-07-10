import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; matchId: string }> },
) {
  const { id, matchId } = await context.params
  return proxyJson(request, `/workspaces/${id}/catalog-matches/${matchId}/dismiss`, {
    method: 'PATCH',
  })
}
