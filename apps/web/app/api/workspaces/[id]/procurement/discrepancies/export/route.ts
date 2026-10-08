import { NextRequest } from 'next/server'
import { proxyRaw } from '@/lib/http/auth-proxy'

// Streams the evidence-trail workbook back to the browser. The bearer lives in
// an httpOnly cookie, so it is attached server-side here; proxyRaw forwards the
// query string and the Content-Disposition the API chose.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return proxyRaw(request, `/workspaces/${id}/procurement/discrepancies/export`, { method: 'GET' })
}
