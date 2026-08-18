import { NextRequest } from 'next/server'
import { proxyRaw } from '../../../../../../../src/lib/http/auth-proxy'

// Serves catalog item photos to <img> tags. The browser cannot attach a bearer
// token to an image request, so the token is added server-side here — same
// pattern as the document download proxy.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await context.params
  return proxyRaw(request, `/workspaces/${id}/catalog-items/${itemId}/photo`, { method: 'GET' })
}
