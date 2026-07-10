import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = await request.json()
  return proxyJson(request, `/workspaces/${id}/procurement/discrepancies/compare`, { method: 'POST', body })
}
