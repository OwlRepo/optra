import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../../src/lib/http/auth-proxy'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; datasetId: string }> },
) {
  const { id, datasetId } = await context.params
  return proxyJson(request, `/workspaces/${id}/datasets/${datasetId}`, { method: 'DELETE' })
}
