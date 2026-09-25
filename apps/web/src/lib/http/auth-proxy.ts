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

  const url = `${API_URL}${backendPath}${request.nextUrl.search}`
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (response.status === 204 || response.status === 205) {
    return new NextResponse(null, { status: response.status })
  }

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

export async function proxyRaw(
  request: NextRequest,
  backendPath: string,
  options: { method: string; body?: unknown },
) {
  const bearer = getBearer(request)

  if (!bearer) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const response = await fetch(`${API_URL}${backendPath}${request.nextUrl.search}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  // Cache-Control is forwarded so the API stays in charge of cacheability.
  // Without it the catalog photo route's `private, max-age=86400`
  // (catalog.controller.ts) was dropped here, so every <img> refetched the
  // bytes through this proxy on each render.
  //
  // X-Content-Type-Options likewise: the API marks every stored-file response
  // nosniff, and these bytes are user uploads served from our own origin.
  // Dropped here, only Caddy stood between them and content sniffing - and
  // Caddy is not in front of local dev, or of anything that bypasses it.
  const headers = new Headers()
  for (const name of [
    'Content-Type',
    'Content-Disposition',
    'Content-Length',
    'Cache-Control',
    'X-Content-Type-Options',
  ]) {
    const value = response.headers.get(name)
    if (value) {
      headers.set(name, value)
    }
  }

  return new Response(response.body, { status: response.status, headers })
}
