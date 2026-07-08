import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../../src/lib/http/auth-proxy'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; flagId: string }> },
) {
  const { id, flagId } = await context.params
  return proxyJson(request, `/workspaces/${id}/insights/freshness-flags/${flagId}/dismiss`, {
    method: 'PATCH',
  })
}
