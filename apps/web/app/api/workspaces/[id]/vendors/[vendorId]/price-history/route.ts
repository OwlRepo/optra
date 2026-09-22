import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

// The proxy forwards `request.nextUrl.search` as-is, so `sku`, `page` and
// `pageSize` reach the API without being restated here.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; vendorId: string }> },
) {
  const { id, vendorId } = await context.params
  return proxyJson(request, `/workspaces/${id}/vendors/${vendorId}/price-history`, { method: 'GET' })
}
