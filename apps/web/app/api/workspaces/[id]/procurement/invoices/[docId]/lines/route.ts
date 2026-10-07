import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

// proxyJson forwards the query string, so page and pageSize reach the API.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await context.params
  return proxyJson(request, `/workspaces/${id}/procurement/invoices/${docId}/lines`, { method: 'GET' })
}
