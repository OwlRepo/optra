import { NextRequest } from 'next/server'
import { proxyJson } from '../../../../../src/lib/http/auth-proxy'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  return proxyJson(request, `/workspaces/accept-invite/${token}`, { method: 'POST' })
}
