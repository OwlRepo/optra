import { NextRequest } from 'next/server'
import { proxyJson } from '@/lib/http/auth-proxy'

export async function POST(request: NextRequest) {
  return proxyJson(request, '/auth/change-password', {
    method: 'POST',
    body: await request.json(),
  })
}
