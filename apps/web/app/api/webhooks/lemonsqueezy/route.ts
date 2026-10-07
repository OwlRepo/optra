import { NextRequest } from 'next/server'
import { forwardRaw } from '../../../../src/lib/http/webhook-proxy'

export async function POST(request: NextRequest) {
  return forwardRaw(request, '/billing/webhooks/lemonsqueezy')
}
