import { NextRequest } from 'next/server'
import { proxyJson, proxyMultipart } from '@/lib/http/auth-proxy'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return proxyJson(request, `/workspaces/${id}/procurement/purchase-orders`, { method: 'GET' })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return proxyMultipart(request, `/workspaces/${id}/procurement/purchase-orders`)
}
