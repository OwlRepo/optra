import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'
const ACCESS_TOKEN_MAX_AGE = 60 * 15

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
  const response = NextResponse.json(data, { status: apiRes.status })

  const setCookie = apiRes.headers.get('set-cookie')
  if (setCookie) response.headers.set('set-cookie', setCookie)

  if (apiRes.ok && data.accessToken) {
    response.cookies.set('mnemra_at', data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })
  }

  return response
}
