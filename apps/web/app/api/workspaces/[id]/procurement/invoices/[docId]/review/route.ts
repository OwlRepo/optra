import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await context.params
  const body = await request.json().catch(() => ({}))
  return proxyJson(request, `/workspaces/${id}/procurement/invoices/${docId}/review`, { method: 'POST', body })
}
