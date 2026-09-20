import { NextRequest } from 'next/server'
import { proxyRaw } from '@/lib/http/auth-proxy'

// Streams the original uploaded document back to the browser. The bearer lives
// in an httpOnly cookie, so it is attached server-side here — same pattern as
// the knowledge-base document download. proxyRaw already forwards
// Content-Disposition, so the filename the API chose survives the hop.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await context.params
  return proxyRaw(request, `/workspaces/${id}/procurement/purchase-orders/${docId}/download`, { method: 'GET' })
}
