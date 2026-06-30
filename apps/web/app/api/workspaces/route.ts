import { NextRequest } from 'next/server'
import { proxyJson } from '../../../src/lib/http/auth-proxy'

export function GET(request: NextRequest) {
  return proxyJson(request, '/workspaces/me', { method: 'GET' })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  return proxyJson(request, '/workspaces', { method: 'POST', body })
}
