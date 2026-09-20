import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

// Mirrors the dismiss proxy next to it: the bearer lives in an httpOnly
// cookie, so the token is attached server-side here.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; flagId: string }> }) {
  const { id, flagId } = await context.params
  return proxyJson(request, `/workspaces/${id}/procurement/discrepancies/${flagId}/decisions`, { method: 'GET' })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; flagId: string }> }) {
  const { id, flagId } = await context.params
  const body = await request.json()
  return proxyJson(request, `/workspaces/${id}/procurement/discrepancies/${flagId}/decisions`, {
    method: 'POST',
    body,
  })
}
