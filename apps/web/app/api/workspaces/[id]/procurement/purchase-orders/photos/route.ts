import { NextRequest } from 'next/server'
import { proxyMultipart } from '@/lib/http/auth-proxy'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return proxyMultipart(request, `/workspaces/${id}/procurement/purchase-orders/photos`)
}
