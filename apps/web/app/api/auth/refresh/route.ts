import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  const rtCookie = request.cookies.get('mnemra_rt')

  const apiRes = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(rtCookie ? { Cookie: `mnemra_rt=${rtCookie.value}` } : {}),
    },
  })

  const data = await apiRes.json()
  return NextResponse.json(data, { status: apiRes.status })
}
