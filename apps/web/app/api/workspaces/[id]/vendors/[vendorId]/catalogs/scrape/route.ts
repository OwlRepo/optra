import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; vendorId: string }> },
) {
  const { id, vendorId } = await context.params
  const body = await request.json()
  return proxyJson(request, `/workspaces/${id}/vendors/${vendorId}/catalogs/scrape`, { method: 'POST', body })
}
