import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; vendorId: string; catalogId: string }> },
) {
  const { id, vendorId, catalogId } = await context.params
  return proxyJson(
    request,
    `/workspaces/${id}/vendors/${vendorId}/catalogs/${catalogId}/items`,
    { method: 'GET' },
  )
}
