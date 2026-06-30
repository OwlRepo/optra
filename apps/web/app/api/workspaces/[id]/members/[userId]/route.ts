import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../src/lib/http/auth-proxy'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await context.params
  return proxyJson(request, `/workspaces/${id}/members/${userId}`, { method: 'DELETE' })
}
