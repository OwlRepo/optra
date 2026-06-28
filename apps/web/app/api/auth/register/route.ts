import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  const body = await request.json()

  const apiRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await apiRes.json()
  return NextResponse.json(data, { status: apiRes.status })
}
