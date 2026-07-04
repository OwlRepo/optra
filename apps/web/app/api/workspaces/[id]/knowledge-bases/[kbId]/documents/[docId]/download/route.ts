import { NextRequest } from 'next/server'
import { proxyRaw } from '../../../../../../../../../src/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string; docId: string }> },
) {
  const { id, kbId, docId } = await context.params
  return proxyRaw(request, `/workspaces/${id}/knowledge-bases/${kbId}/documents/${docId}/download`, {
    method: 'GET',
  })
}
