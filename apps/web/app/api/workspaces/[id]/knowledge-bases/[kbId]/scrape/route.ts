import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../../src/lib/http/auth-proxy'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string }> },
) {
  const { id, kbId } = await context.params
  const body = await request.json()

  return proxyJson(request, `/workspaces/${id}/knowledge-bases/${kbId}/scrape`, {
    method: 'POST',
    body,
  })
}
