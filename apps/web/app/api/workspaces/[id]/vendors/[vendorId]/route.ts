import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; vendorId: string }> },
) {
  const { id, vendorId } = await context.params
  return proxyJson(request, `/workspaces/${id}/vendors/${vendorId}`, { method: 'GET' })
}
