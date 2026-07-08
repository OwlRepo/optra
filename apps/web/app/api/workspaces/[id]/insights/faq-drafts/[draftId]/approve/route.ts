import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../../../src/lib/http/auth-proxy'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; draftId: string }> },
) {
  const { id, draftId } = await context.params
  return proxyJson(request, `/workspaces/${id}/insights/faq-drafts/${draftId}/approve`, {
    method: 'PATCH',
  })
}
