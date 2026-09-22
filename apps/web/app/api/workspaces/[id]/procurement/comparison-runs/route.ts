import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

// One route file per backend path — there is no catch-all proxy here.
// `proxyJson` forwards the query string, so paging and the pair filter need
// nothing extra on this side.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return proxyJson(request, `/workspaces/${id}/procurement/comparison-runs`, { method: 'GET' })
}
