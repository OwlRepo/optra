import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  const body = await request.json()

  const apiRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await apiRes.json()
  const response = NextResponse.json(data, { status: apiRes.status })

  const setCookie = apiRes.headers.get('set-cookie')
  if (setCookie) response.headers.set('set-cookie', setCookie)

  return response
}
