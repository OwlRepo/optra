import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export function getBearer(request: NextRequest): string | null {
  return request.cookies.get('mnemra_at')?.value ?? null
}

export async function proxyJson(
  request: NextRequest,
  backendPath: string,
  options: { method: string; body?: unknown },
) {
  const bearer = getBearer(request)

  if (!bearer) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const response = await fetch(`${API_URL}${backendPath}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await response.json().catch(() => ({}))
  return NextResponse.json(data, { status: response.status })
}

export async function proxyMultipart(request: NextRequest, backendPath: string) {
  const bearer = getBearer(request)

  if (!bearer) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData()
  const response = await fetch(`${API_URL}${backendPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
    body: form,
  })

  const data = await response.json().catch(() => ({}))
  return NextResponse.json(data, { status: response.status })
}
