import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../../../src/lib/http/auth-proxy'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; kbId: string; docId: string }> },
) {
  const { id, kbId, docId } = await context.params
  return proxyJson(request, `/workspaces/${id}/knowledge-bases/${kbId}/documents/${docId}`, {
    method: 'DELETE',
  })
}
