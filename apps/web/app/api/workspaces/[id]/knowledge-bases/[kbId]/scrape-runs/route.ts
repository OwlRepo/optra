import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../../src/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string }> },
) {
  const { id, kbId } = await context.params
  return proxyJson(request, `/workspaces/${id}/knowledge-bases/${kbId}/scrape-runs`, { method: 'GET' })
}
