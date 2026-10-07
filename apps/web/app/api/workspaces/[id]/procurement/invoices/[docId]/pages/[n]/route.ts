import { NextRequest } from 'next/server'
import { proxyRaw } from '@/lib/http/auth-proxy'

// Streams one normalized photo page for the review modal's <img>.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; docId: string; n: string }> }) {
  const { id, docId, n } = await context.params
  return proxyRaw(request, `/workspaces/${id}/procurement/invoices/${docId}/pages/${n}`, { method: 'GET' })
}
